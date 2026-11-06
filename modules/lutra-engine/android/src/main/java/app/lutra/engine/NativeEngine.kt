package app.lutra.engine

import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import android.opengl.EGLSurface
import android.os.Build
import android.os.SystemClock
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong

private class ClipInfo(
  val uri: String,
  val videoTrack: Int,
  val videoMime: String,
  val audioTrack: Int?,
  val audioFormat: MediaFormat?,
  val rawW: Int,
  val rawH: Int,
  val rot: Int,
  val displayW: Double,
  val displayH: Double,
  val fps: Double,
)

/**
 * Native render engine (Android). Same contract as the WebView engine
 * (engine/web/main.ts): emits EngineEvent JSON, but reads the clips and writes
 * the outputs directly on disk.
 *
 * Pipeline per output: MediaExtractor -> MediaCodec decoder -> SurfaceTexture
 * (OES) -> GLES grade shader -> encoder input surface -> MediaMuxer.
 * Audio is packet-copied when every clip already matches, else re-encoded.
 */
class NativeEngine(private val context: Context, private val emit: (String) -> Unit) {
  private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "lutra-render").apply { priority = Thread.MAX_PRIORITY - 1 } }
  @Volatile private var canceled = false

  private fun send(vararg pairs: Pair<String, Any?>) {
    val o = JSONObject()
    for ((k, v) in pairs) o.put(k, v)
    emit(o.toString())
  }

  fun cancel() {
    canceled = true
  }

  fun render(job: RenderJob, sources: Map<String, String>, destinations: Map<String, String>, vertex: String, fragment: String) {
    canceled = false
    executor.execute {
      val grader = try {
        GlGrader(vertex, fragment)
      } catch (e: Throwable) {
        send("type" to "outputError", "outIndex" to -1, "message" to "OpenGL ES: ${e.message}")
        send("type" to "jobDone", "canceled" to false)
        return@execute
      }
      try {
        for (out in job.outputs) {
          if (canceled) break
          try {
            renderOutput(grader, job, out, sources, destinations[out.index.toString()])
          } catch (e: Throwable) {
            if (!canceled) send("type" to "outputError", "outIndex" to out.index, "message" to (e.message ?: e.toString()))
          }
        }
      } finally {
        try { grader.release() } catch (_: Throwable) {}
        send("type" to "jobDone", "canceled" to canceled)
      }
    }
  }

  private fun openClip(uri: String): ClipInfo {
    val ex = openExtractor(context, uri)
    try {
      var video = -1
      var audio: Int? = null
      for (i in 0 until ex.trackCount) {
        val mime = ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
        if (video < 0 && mime.startsWith("video/")) video = i
        if (audio == null && mime.startsWith("audio/")) audio = i
      }
      if (video < 0) throw EngineError("@noVideoTrack")
      val vf = ex.getTrackFormat(video)
      val w = vf.getInteger(MediaFormat.KEY_WIDTH)
      val h = vf.getInteger(MediaFormat.KEY_HEIGHT)
      val deg = if (Build.VERSION.SDK_INT >= 23) vf.intOr(MediaFormat.KEY_ROTATION, 0) else vf.intOr("rotation-degrees", 0)
      val rot = (((deg / 90.0).roundToInt() % 4) + 4) % 4
      val swap = rot % 2 == 1
      return ClipInfo(
        uri = uri,
        videoTrack = video,
        videoMime = vf.getString(MediaFormat.KEY_MIME) ?: "",
        audioTrack = audio,
        audioFormat = audio?.let { ex.getTrackFormat(it) },
        rawW = w,
        rawH = h,
        rot = rot,
        displayW = (if (swap) h else w).toDouble(),
        displayH = (if (swap) w else h).toDouble(),
        fps = Geometry.snapFrameRate(vf.rateOr(MediaFormat.KEY_FRAME_RATE, 30.0)),
      )
    } finally {
      ex.release()
    }
  }

  private fun pickCodec(out: RenderOutput, w: Int, h: Int): String {
    val order = listOf(out.codec) + (Geometry.containerCodecs[out.container] ?: emptyList()).filter { it != out.codec }
    for (c in order) {
      if (Codecs.muxable(out.container, c) && Codecs.hasVideoEncoder(Codecs.videoMime[c]!!, w, h)) return c
    }
    throw EngineError("@noEncoder|${out.container.uppercase()}|$w×$h")
  }

  private fun createVideoEncoder(mime: String, w: Int, h: Int, fps: Double, bitrate: Int): MediaCodec {
    val fmt = MediaFormat.createVideoFormat(mime, w, h).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
      setFloat(MediaFormat.KEY_FRAME_RATE, fps.toFloat())
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
      if (Build.VERSION.SDK_INT >= 24) {
        setInteger(MediaFormat.KEY_COLOR_STANDARD, MediaFormat.COLOR_STANDARD_BT709)
        setInteger(MediaFormat.KEY_COLOR_RANGE, MediaFormat.COLOR_RANGE_LIMITED)
        setInteger(MediaFormat.KEY_COLOR_TRANSFER, MediaFormat.COLOR_TRANSFER_SDR_VIDEO)
      }
    }
    val name = MediaCodecList(MediaCodecList.REGULAR_CODECS).findEncoderForFormat(fmt)
    val codec = if (name != null) MediaCodec.createByCodecName(name) else MediaCodec.createEncoderByType(mime)
    try {
      codec.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    } catch (e: Exception) {
      codec.release()
      throw EngineError("@noEncoder|${mime.substringAfter('/').uppercase()}|$w×$h")
    }
    return codec
  }

  /** Picks the audio strategy shared by every segment of an output. */
  private fun makeAudioLane(out: RenderOutput, clips: Map<String, ClipInfo>, mux: () -> PendingMuxer): Pair<String, (() -> AudioLane)?> {
    if (!out.audio) return Pair("none", null)
    val want = if (out.container == "webm") MediaFormat.MIMETYPE_AUDIO_OPUS else MediaFormat.MIMETYPE_AUDIO_AAC
    val formats = out.segments.map { clips[it.clipKey]!!.audioFormat }
    val present = formats.filterNotNull()
    if (present.isEmpty()) return Pair("none", null)
    val a0 = present[0]
    val rate = a0.intOr(MediaFormat.KEY_SAMPLE_RATE, 48000)
    val ch = a0.intOr(MediaFormat.KEY_CHANNEL_COUNT, 2)
    val sameShape = present.all { it.intOr(MediaFormat.KEY_SAMPLE_RATE, -1) == rate && it.intOr(MediaFormat.KEY_CHANNEL_COUNT, -1) == ch }
    val sameCodec = present.all { it.getString(MediaFormat.KEY_MIME) == want }
    if (sameShape && sameCodec && present.size == formats.size) {
      return Pair("copy") { CopyAudioLane(mux(), a0, { canceled }) }
    }
    if (sameShape && ch <= 2 && Codecs.audioEncoderFor(want, rate, ch)) {
      return Pair("encode") { EncodeAudioLane(mux(), want, rate, ch, { canceled }) }
    }
    send("type" to "log", "message" to "audio dropped: clips differ in sample rate/channels or no $want encoder")
    return Pair("none", null)
  }

  private fun renderOutput(grader: GlGrader, job: RenderJob, out: RenderOutput, sources: Map<String, String>, destination: String?) {
    if (destination == null) throw EngineError("no destination")
    val clips = HashMap<String, ClipInfo>()
    for (seg in out.segments) {
      if (!clips.containsKey(seg.clipKey)) clips[seg.clipKey] = openClip(sources[seg.clipKey] ?: throw EngineError("unknown file"))
    }
    val first = clips[out.segments[0].clipKey]!!
    val fps = out.fps ?: first.fps
    val (width, height) = Geometry.outputSize(first.displayW, first.displayH, out.aspect, out.resolution)
    val outAspect = Geometry.aspectValue(out.aspect, first.displayW, first.displayH)
    val codec = pickCodec(out, width, height)
    val bitrate = Geometry.bitrate(width, height, fps, out.quality, codec)
    val frames = out.segments.sumOf { max(1, ((it.end - it.start) * fps).roundToInt()) }

    val path = filePath(destination)
    File(path).apply {
      parentFile?.mkdirs()
      if (exists()) delete()
    }

    var muxer: PendingMuxer? = null
    val (audioMode, laneFactory) = makeAudioLane(out, clips) { muxer!! }
    muxer = PendingMuxer(path, out.container, if (laneFactory != null) 2 else 1)
    val mux = muxer
    val encoder = createVideoEncoder(Codecs.videoMime[codec]!!, width, height, fps, bitrate)
    var window: EGLSurface? = null
    var audio: AudioLane? = null
    var ok = false
    try {
      val inputSurface = encoder.createInputSurface()
      encoder.start()
      val win = grader.createWindowSurface(inputSurface)
      window = win
      grader.makeCurrent(win)
      audio = laneFactory?.invoke()

      send(
        "type" to "outputStart", "outIndex" to out.index, "width" to width, "height" to height, "fps" to fps,
        "frames" to frames, "codec" to codec, "audio" to audioMode,
      )

      val info = MediaCodec.BufferInfo()
      fun drainVideo(eos: Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 5000
        while (true) {
          val idx = encoder.dequeueOutputBuffer(info, if (eos) 10000 else 0)
          if (idx == MediaCodec.INFO_TRY_AGAIN_LATER) {
            if (!eos || SystemClock.elapsedRealtime() > deadline) return
            continue
          }
          if (idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
            mux.addTrack(TRACK_VIDEO, encoder.outputFormat)
            continue
          }
          if (idx < 0) continue
          val buf = encoder.getOutputBuffer(idx)!!
          if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) mux.write(TRACK_VIDEO, buf, info)
          encoder.releaseOutputBuffer(idx, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
        }
      }

      var done = 0
      var offset = 0.0
      val t0 = SystemClock.elapsedRealtime()
      var lastProgress = 0L
      var lastPreview = 0L

      for (seg in out.segments) {
        if (canceled) break
        val clip = clips[seg.clipKey]!!
        grader.setLut(seg.lutKey, job.luts[seg.lutKey] ?: throw EngineError("missing LUT"))
        val segFrames = max(1, ((seg.end - seg.start) * fps).roundToInt())
        val crop = Geometry.coverCrop(clip.displayW, clip.displayH, outAspect)
        val fx = floatArrayOf((seg.effects.vignette / 100).toFloat(), (seg.effects.grain / 100).toFloat(), seg.effects.grainSize.toFloat(), (seg.effects.sharpen / 100).toFloat())
        val startUs = (seg.start * 1e6).roundToLong()
        val endUs = (seg.end * 1e6).roundToLong()
        val segEndOut = offset + segFrames / fps
        audio?.begin(context, clip.uri, clip.audioTrack, startUs, endUs, (offset * 1e6).roundToLong(), (segEndOut * 1e6).roundToLong())

        val ex = openExtractor(context, clip.uri)
        var decoder: MediaCodec? = null
        try {
          ex.selectTrack(clip.videoTrack)
          ex.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
          val vf = ex.getTrackFormat(clip.videoTrack)
          // Rotation is applied by the shader (uRot), not by the decoder.
          if (Build.VERSION.SDK_INT >= 23 && vf.containsKey(MediaFormat.KEY_ROTATION)) vf.setInteger(MediaFormat.KEY_ROTATION, 0)
          val name = try { MediaCodecList(MediaCodecList.REGULAR_CODECS).findDecoderForFormat(vf) } catch (_: Exception) { null }
          decoder = try {
            if (name != null) MediaCodec.createByCodecName(name) else MediaCodec.createDecoderByType(clip.videoMime)
          } catch (_: Exception) {
            throw EngineError("@cannotDecode|${clip.videoMime.substringAfter('/')}")
          }
          try {
            decoder.configure(vf, grader.decoderSurface, null, 0)
            decoder.start()
          } catch (_: Exception) {
            throw EngineError("@cannotDecode|${clip.videoMime.substringAfter('/')}")
          }
          val dinfo = MediaCodec.BufferInfo()
          var inputDone = false
          var haveFrame = false
          var k = 0
          fun target(i: Int) = startUs + ((i + 0.5) / fps * 1e6).roundToLong()

          fun emitFrame(i: Int) {
            val local = i / fps
            val remain = (segFrames - i) / fps
            var mul = 1.0
            if (seg.fadeIn > 0) mul = min(mul, local / seg.fadeIn)
            if (seg.fadeOut > 0) mul = min(mul, remain / seg.fadeOut)
            val u = GlGrader.Uniforms(
              clip.rawW.toFloat(), clip.rawH.toFloat(), clip.rot.toFloat(), crop, fx,
              (offset + local).toFloat(), mul.coerceIn(0.0, 1.0).toFloat(),
            )
            val now = SystemClock.elapsedRealtime()
            val preview = if (now - lastPreview > 900) {
              lastPreview = now
              grader.previewDataUrl(width, height, u)
            } else null
            grader.draw(width, height, u)
            val ts = offset + i / fps
            grader.present(win, (ts * 1e9).roundToLong())
            drainVideo(false)
            audio?.pump(((ts + 0.5) * 1e6).roundToLong())
            done++
            if (preview != null) send("type" to "preview", "dataUrl" to preview)
            if (now - lastProgress > 250) {
              lastProgress = now
              send("type" to "progress", "outIndex" to out.index, "frame" to done, "frames" to frames, "fps" to done / max((now - t0) / 1000.0, 0.001))
            }
          }

          while (k < segFrames && !canceled) {
            if (!inputDone) {
              val ii = decoder.dequeueInputBuffer(5000)
              if (ii >= 0) {
                val b = decoder.getInputBuffer(ii)!!
                val n = ex.readSampleData(b, 0)
                if (n < 0 || ex.sampleTime > endUs + 1_000_000) {
                  decoder.queueInputBuffer(ii, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                  inputDone = true
                } else {
                  decoder.queueInputBuffer(ii, 0, n, ex.sampleTime, 0)
                  ex.advance()
                }
              }
            }
            val oi = decoder.dequeueOutputBuffer(dinfo, 5000)
            if (oi < 0) continue
            val eos = dinfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
            if (dinfo.size != 0) {
              val p = dinfo.presentationTimeUs
              // Frames for targets before this one use the previous decoded frame
              // (repeats/drops for frame-rate changes, like the web engine).
              while (haveFrame && k < segFrames && target(k) < p && !canceled) emitFrame(k++)
              if (k >= segFrames || canceled) {
                decoder.releaseOutputBuffer(oi, false)
                break
              }
              decoder.releaseOutputBuffer(oi, true)
              if (!grader.awaitFrame()) throw EngineError("Decoder frame timeout")
              haveFrame = true
            } else {
              decoder.releaseOutputBuffer(oi, false)
            }
            if (eos) {
              while (haveFrame && k < segFrames && !canceled) emitFrame(k++)
              break
            }
          }
          if (!haveFrame && !canceled) throw EngineError("@cannotDecode|${clip.videoMime.substringAfter('/')}")
        } finally {
          try { decoder?.stop() } catch (_: Exception) {}
          try { decoder?.release() } catch (_: Exception) {}
          ex.release()
        }
        if (canceled) break
        audio?.pump((segEndOut * 1e6).roundToLong())
        audio?.end()
        offset = segEndOut
      }

      if (canceled) return
      encoder.signalEndOfInputStream()
      drainVideo(true)
      audio?.finish()
      mux.finish()
      ok = true
      send("type" to "progress", "outIndex" to out.index, "frame" to frames, "frames" to frames, "fps" to done / max((SystemClock.elapsedRealtime() - t0) / 1000.0, 0.001))
      send(
        "type" to "outputDone", "outIndex" to out.index, "duration" to offset,
        "mime" to when (out.container) { "webm" -> "video/webm"; "mov" -> "video/quicktime"; else -> "video/mp4" },
      )
    } finally {
      try { audio?.release() } catch (_: Exception) {}
      if (window != null) try { grader.releaseWindowSurface(window) } catch (_: Exception) {}
      try { encoder.stop() } catch (_: Exception) {}
      try { encoder.release() } catch (_: Exception) {}
      if (!ok) mux.abort()
    }
  }

  companion object {
    fun caps(): JSONObject {
      val video = JSONObject()
      for ((id, mime) in Codecs.videoMime) {
        val muxable = Codecs.muxable("mp4", id) || Codecs.muxable("webm", id)
        video.put(id, JSONObject().apply {
          put("hd", muxable && Codecs.hasVideoEncoder(mime, 1920, 1080))
          put("uhd", muxable && Codecs.hasVideoEncoder(mime, 3840, 2160))
        })
      }
      val soc = if (Build.VERSION.SDK_INT >= 31) Build.SOC_MODEL else Build.HARDWARE
      return JSONObject().apply {
        put("backend", "native")
        put("gpu", "OpenGL ES · $soc")
        put("webcodecs", false)
        put("webgl", 0)
        put("video", video)
        put("audio", JSONObject().apply {
          put("aac", Codecs.hasEncoder(MediaFormat.MIMETYPE_AUDIO_AAC))
          put("opus", Codecs.hasEncoder(MediaFormat.MIMETYPE_AUDIO_OPUS))
        })
        put("userAgent", "Lutra native (Android ${Build.VERSION.RELEASE}; ${Build.MODEL})")
      }
    }
  }
}
