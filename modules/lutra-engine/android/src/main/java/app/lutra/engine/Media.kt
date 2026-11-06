package app.lutra.engine

import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import java.nio.ByteBuffer
import kotlin.math.min
import kotlin.math.roundToLong

const val TRACK_VIDEO = 0
const val TRACK_AUDIO = 1

fun openExtractor(context: Context, uri: String): MediaExtractor {
  val ex = MediaExtractor()
  when {
    uri.startsWith("file://") -> ex.setDataSource(Uri.parse(uri).path!!)
    uri.startsWith("/") -> ex.setDataSource(uri)
    else -> ex.setDataSource(context, Uri.parse(uri), null)
  }
  return ex
}

fun filePath(uri: String): String = if (uri.startsWith("file://")) Uri.parse(uri).path!! else uri

fun MediaFormat.intOr(key: String, fallback: Int): Int =
  if (containsKey(key)) try { getInteger(key) } catch (_: Exception) { try { getFloat(key).toInt() } catch (_: Exception) { fallback } } else fallback

fun MediaFormat.rateOr(key: String, fallback: Double): Double =
  if (containsKey(key)) try { getInteger(key).toDouble() } catch (_: Exception) { try { getFloat(key).toDouble() } catch (_: Exception) { fallback } } else fallback

object Codecs {
  val videoMime = mapOf("avc" to "video/avc", "hevc" to "video/hevc", "vp9" to "video/x-vnd.on2.vp9", "av1" to "video/av01")

  private val list by lazy { MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos }

  fun hasVideoEncoder(mime: String, w: Int, h: Int): Boolean = list.any { info ->
    info.isEncoder && info.supportedTypes.any { it.equals(mime, true) } &&
      try {
        val vc = info.getCapabilitiesForType(mime).videoCapabilities
        vc != null && (vc.isSizeSupported(w, h) || vc.isSizeSupported(h, w))
      } catch (_: Exception) { false }
  }

  fun hasEncoder(mime: String): Boolean = list.any { info -> info.isEncoder && info.supportedTypes.any { it.equals(mime, true) } }

  fun audioEncoderFor(mime: String, rate: Int, channels: Int): Boolean = list.any { info ->
    info.isEncoder && info.supportedTypes.any { it.equals(mime, true) } &&
      try {
        val ac = info.getCapabilitiesForType(mime).audioCapabilities
        ac != null && ac.isSampleRateSupported(rate) && ac.maxInputChannelCount >= channels
      } catch (_: Exception) { false }
  }

  /** Whether MediaMuxer can put this codec in the container on this OS version. */
  fun muxable(container: String, codec: String): Boolean = when (container) {
    "webm" -> codec == "vp9"
    else -> codec == "avc" || codec == "hevc" || (codec == "av1" && android.os.Build.VERSION.SDK_INT >= 34)
  }
}

/**
 * MediaMuxer that starts once every expected track has a format, buffering
 * samples written before that (encoder formats arrive with the first output).
 */
class PendingMuxer(path: String, container: String, private val expected: Int) {
  private val muxer = MediaMuxer(
    path,
    if (container == "webm") MediaMuxer.OutputFormat.MUXER_OUTPUT_WEBM else MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4,
  )
  private val indices = intArrayOf(-1, -1)
  private var added = 0
  private var started = false
  private var released = false
  private val queue = ArrayList<Triple<Int, ByteArray, MediaCodec.BufferInfo>>()

  fun hasTrack(kind: Int) = indices[kind] >= 0

  fun addTrack(kind: Int, format: MediaFormat) {
    if (indices[kind] >= 0 || started) return
    indices[kind] = muxer.addTrack(format)
    added++
    if (added >= expected) start()
  }

  private fun start() {
    muxer.start()
    started = true
    for ((kind, bytes, info) in queue) muxer.writeSampleData(indices[kind], ByteBuffer.wrap(bytes), info)
    queue.clear()
  }

  fun write(kind: Int, buf: ByteBuffer, info: MediaCodec.BufferInfo) {
    if (indices[kind] < 0 || info.size <= 0) return
    if (started) {
      muxer.writeSampleData(indices[kind], buf, info)
      return
    }
    val bytes = ByteArray(info.size)
    val dup = buf.duplicate()
    dup.position(info.offset)
    dup.limit(info.offset + info.size)
    dup.get(bytes)
    val copy = MediaCodec.BufferInfo().apply { set(0, info.size, info.presentationTimeUs, info.flags) }
    queue.add(Triple(kind, bytes, copy))
  }

  fun finish() {
    if (!started) {
      if (added == 0) throw EngineError("No media was encoded")
      start()
    }
    muxer.stop()
    muxer.release()
    released = true
  }

  fun abort() {
    if (released) return
    try { if (started) muxer.stop() } catch (_: Exception) {}
    try { muxer.release() } catch (_: Exception) {}
    released = true
  }
}

/** Common interface of the output's audio track writers. */
interface AudioLane {
  fun begin(context: Context, uri: String, track: Int?, startUs: Long, endUs: Long, offsetUs: Long, segEndOutUs: Long)
  fun pump(untilUs: Long)
  fun end()
  fun finish()
  fun release()
}

/** Packet copy (no re-encode): every clip already has the container's codec and format. */
class CopyAudioLane(private val mux: PendingMuxer, format: MediaFormat, private val canceled: () -> Boolean) : AudioLane {
  private var ex: MediaExtractor? = null
  private val buf = ByteBuffer.allocateDirect(format.intOr(MediaFormat.KEY_MAX_INPUT_SIZE, 0).coerceAtLeast(256 * 1024))
  private val info = MediaCodec.BufferInfo()
  private var pending = false
  private var done = true
  private var startUs = 0L
  private var endUs = 0L
  private var offsetUs = 0L
  private var lastPts = -1L

  init {
    mux.addTrack(TRACK_AUDIO, format)
  }

  override fun begin(context: Context, uri: String, track: Int?, startUs: Long, endUs: Long, offsetUs: Long, segEndOutUs: Long) {
    end()
    this.startUs = startUs
    this.endUs = endUs
    this.offsetUs = offsetUs
    if (track == null) return
    ex = openExtractor(context, uri).apply {
      selectTrack(track)
      seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
    }
    done = false
  }

  override fun pump(untilUs: Long) {
    val ex = ex ?: return
    while (!done && !canceled()) {
      if (!pending) {
        buf.clear()
        val size = ex.readSampleData(buf, 0)
        if (size < 0) {
          done = true
          break
        }
        val pts = ex.sampleTime
        ex.advance()
        if (pts < startUs) continue
        if (pts >= endUs) {
          done = true
          break
        }
        info.set(0, size, offsetUs + (pts - startUs), MediaCodec.BUFFER_FLAG_KEY_FRAME)
        pending = true
      }
      if (info.presentationTimeUs > untilUs) return
      if (info.presentationTimeUs <= lastPts) info.presentationTimeUs = lastPts + 1
      mux.write(TRACK_AUDIO, buf, info)
      lastPts = info.presentationTimeUs
      pending = false
    }
  }

  override fun end() {
    try { ex?.release() } catch (_: Exception) {}
    ex = null
    pending = false
    done = true
  }

  override fun finish() = end()

  override fun release() = end()
}

/**
 * Decode -> PCM -> encode (AAC, or Opus for WebM). Clips must share the
 * sample rate and channel count; gaps are filled with silence so merged clips
 * stay in sync.
 */
class EncodeAudioLane(
  private val mux: PendingMuxer,
  mime: String,
  private val rate: Int,
  private val channels: Int,
  private val canceled: () -> Boolean,
) : AudioLane {
  private val encoder: MediaCodec = MediaCodec.createEncoderByType(mime)
  private val frameBytes = 2 * channels
  private val info = MediaCodec.BufferInfo()
  private var cursor = 0L // frames on the output timeline
  private var segEnd = 0L
  private var startUs = 0L
  private var endUs = 0L
  private var offsetUs = 0L
  private var ex: MediaExtractor? = null
  private var decoder: MediaCodec? = null
  private var inputDone = true
  private var srcDone = true
  private var pcm: ByteArray? = null
  private var pcmPos = 0
  private var pcmFrame = 0L
  private val silence = ByteArray(1024 * frameBytes)
  private var finished = false

  init {
    val fmt = MediaFormat.createAudioFormat(mime, rate, channels).apply {
      setInteger(MediaFormat.KEY_BIT_RATE, 192000)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
      if (mime == MediaFormat.MIMETYPE_AUDIO_AAC) setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
    }
    encoder.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    encoder.start()
  }

  private fun frames(us: Long) = (us.toDouble() * rate / 1e6).roundToLong()
  private fun us(frames: Long) = (frames.toDouble() * 1e6 / rate).roundToLong()

  override fun begin(context: Context, uri: String, track: Int?, startUs: Long, endUs: Long, offsetUs: Long, segEndOutUs: Long) {
    end()
    this.startUs = startUs
    this.endUs = endUs
    this.offsetUs = offsetUs
    segEnd = frames(segEndOutUs)
    if (track == null) return
    try {
      val e = openExtractor(context, uri)
      e.selectTrack(track)
      e.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      val fmt = e.getTrackFormat(track)
      val d = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME)!!)
      d.configure(fmt, null, null, 0)
      d.start()
      ex = e
      decoder = d
      inputDone = false
      srcDone = false
    } catch (_: Exception) {
      end()
    }
  }

  override fun pump(untilUs: Long) {
    val limit = min(frames(untilUs), segEnd)
    var idle = 0
    while (!finished && !canceled() && cursor < limit) {
      drain(false)
      if (pcm == null) {
        if (srcDone) {
          val n = min(1024L, limit - cursor).toInt()
          if (feed(silence, 0, n * frameBytes, cursor) == 0) idle++ else cursor += n
          if (idle > 400) return
          continue
        }
        if (!nextPcm()) {
          if (++idle > 400) return
          continue
        }
        idle = 0
      }
      val chunk = pcm!!
      // Align the chunk with the cursor: drop overlap, fill gaps with silence.
      if (pcmFrame < cursor) {
        val skip = ((cursor - pcmFrame) * frameBytes).coerceAtMost((chunk.size - pcmPos).toLong()).toInt()
        pcmPos += skip
        pcmFrame += skip / frameBytes
      }
      if (pcmPos >= chunk.size) {
        pcm = null
        continue
      }
      if (pcmFrame >= segEnd) {
        pcm = null
        srcDone = true
        continue
      }
      if (pcmFrame > limit) return
      if (pcmFrame > cursor + 96) {
        val n = min(1024L, pcmFrame - cursor).toInt()
        if (feed(silence, 0, n * frameBytes, cursor) > 0) cursor += n
        continue
      }
      val maxBytes = ((segEnd - cursor) * frameBytes).coerceAtMost((chunk.size - pcmPos).toLong()).toInt()
      val n = feed(chunk, pcmPos, maxBytes, cursor)
      if (n == 0) {
        if (++idle > 400) return
        continue
      }
      idle = 0
      pcmPos += n
      cursor += n / frameBytes
      pcmFrame = cursor
      if (pcmPos >= chunk.size) pcm = null
    }
  }

  /** Queues PCM into the encoder; returns bytes consumed (0 if no input buffer was free). */
  private fun feed(bytes: ByteArray, off: Int, len: Int, atFrame: Long): Int {
    if (len <= 0) return 0
    val idx = encoder.dequeueInputBuffer(5000)
    if (idx < 0) return 0
    val inBuf = encoder.getInputBuffer(idx)!!
    inBuf.clear()
    val n = (min(len, inBuf.capacity()) / frameBytes) * frameBytes
    inBuf.put(bytes, off, n)
    encoder.queueInputBuffer(idx, 0, n, us(atFrame), 0)
    return n
  }

  /** Pulls one decoded PCM chunk into [pcm]; false if none is ready yet. */
  private fun nextPcm(): Boolean {
    val d = decoder ?: run { srcDone = true; return false }
    val e = ex!!
    while (!inputDone) {
      val ii = d.dequeueInputBuffer(0)
      if (ii < 0) break
      val b = d.getInputBuffer(ii)!!
      val n = e.readSampleData(b, 0)
      if (n < 0 || e.sampleTime >= endUs) {
        d.queueInputBuffer(ii, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
        inputDone = true
      } else {
        d.queueInputBuffer(ii, 0, n, e.sampleTime, 0)
        e.advance()
      }
    }
    val oi = d.dequeueOutputBuffer(info, 5000)
    if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
      val f = d.outputFormat
      if (f.intOr(MediaFormat.KEY_SAMPLE_RATE, rate) != rate || f.intOr(MediaFormat.KEY_CHANNEL_COUNT, channels) != channels) {
        srcDone = true // format mismatch: this segment's audio becomes silence
      }
      return false
    }
    if (oi < 0) return false
    val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
    var got = false
    if (info.size > 0) {
      val out = d.getOutputBuffer(oi)!!
      out.position(info.offset)
      out.limit(info.offset + info.size)
      val bytes = ByteArray(info.size)
      out.get(bytes)
      val pts = info.presentationTimeUs
      if (pts >= endUs) {
        srcDone = true
      } else {
        pcm = bytes
        pcmPos = 0
        pcmFrame = frames(offsetUs + pts - startUs)
        got = true
      }
    }
    d.releaseOutputBuffer(oi, false)
    if (eos) srcDone = true
    return got
  }

  private fun drain(eos: Boolean) {
    val deadline = System.currentTimeMillis() + 3000
    while (true) {
      val idx = encoder.dequeueOutputBuffer(info, if (eos) 10000 else 0)
      if (idx == MediaCodec.INFO_TRY_AGAIN_LATER) {
        if (!eos || System.currentTimeMillis() > deadline) return
        continue
      }
      if (idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        mux.addTrack(TRACK_AUDIO, encoder.outputFormat)
        continue
      }
      if (idx < 0) continue
      val buf = encoder.getOutputBuffer(idx)!!
      if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) mux.write(TRACK_AUDIO, buf, info)
      encoder.releaseOutputBuffer(idx, false)
      if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
    }
  }

  override fun end() {
    try { decoder?.stop() } catch (_: Exception) {}
    try { decoder?.release() } catch (_: Exception) {}
    try { ex?.release() } catch (_: Exception) {}
    decoder = null
    ex = null
    pcm = null
    inputDone = true
    srcDone = true
  }

  override fun finish() {
    end()
    if (finished) return
    finished = true
    var tries = 0
    while (tries++ < 200) {
      val idx = encoder.dequeueInputBuffer(10000)
      if (idx >= 0) {
        encoder.queueInputBuffer(idx, 0, 0, us(cursor), MediaCodec.BUFFER_FLAG_END_OF_STREAM)
        break
      }
      drain(false)
    }
    drain(true)
  }

  override fun release() {
    end()
    try { encoder.stop() } catch (_: Exception) {}
    try { encoder.release() } catch (_: Exception) {}
  }
}
