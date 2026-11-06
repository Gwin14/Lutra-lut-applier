package app.lutra.engine

import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong

// Mirrors src/engine/protocol.ts.

class LutPayload(val size: Float, val cols: Float, val width: Int, val height: Int, val b64: String)

class SegmentEffects(val vignette: Double, val grain: Double, val grainSize: Double, val sharpen: Double)

class RenderSegment(
  val clipKey: String,
  val start: Double,
  val end: Double,
  val lutKey: String,
  val effects: SegmentEffects,
  val fadeIn: Double,
  val fadeOut: Double,
)

class RenderOutput(
  val index: Int,
  val container: String,
  val codec: String,
  val aspect: String,
  val resolution: String,
  /** null = source frame rate. */
  val fps: Double?,
  val quality: String,
  val audio: Boolean,
  val segments: List<RenderSegment>,
)

class RenderJob(val id: String, val luts: Map<String, LutPayload>, val outputs: List<RenderOutput>) {
  companion object {
    fun parse(json: String): RenderJob {
      val o = JSONObject(json)
      val lutsJson = o.getJSONObject("luts")
      val luts = HashMap<String, LutPayload>()
      for (key in lutsJson.keys()) {
        val l = lutsJson.getJSONObject(key)
        luts[key] = LutPayload(
          l.getDouble("size").toFloat(), l.getDouble("cols").toFloat(), l.getInt("width"), l.getInt("height"), l.getString("b64"),
        )
      }
      val outs = o.getJSONArray("outputs")
      val outputs = (0 until outs.length()).map { i ->
        val out = outs.getJSONObject(i)
        val segs = out.getJSONArray("segments")
        RenderOutput(
          index = out.getInt("index"),
          container = out.getString("container"),
          codec = out.getString("codec"),
          aspect = out.getString("aspect"),
          resolution = out.getString("resolution"),
          fps = out.opt("fps").let { if (it is Number) it.toDouble() else null },
          quality = out.getString("quality"),
          audio = out.optBoolean("audio", true),
          segments = (0 until segs.length()).map { j ->
            val s = segs.getJSONObject(j)
            val fx = s.getJSONObject("effects")
            RenderSegment(
              clipKey = s.getString("clipKey"),
              start = s.getDouble("start"),
              end = s.getDouble("end"),
              lutKey = s.getString("lutKey"),
              effects = SegmentEffects(
                fx.optDouble("vignette", 0.0), fx.optDouble("grain", 0.0), fx.optDouble("grainSize", 1.0), fx.optDouble("sharpen", 0.0),
              ),
              fadeIn = s.optDouble("fadeIn", 0.0),
              fadeOut = s.optDouble("fadeOut", 0.0),
            )
          },
        )
      }
      return RenderJob(o.optString("id"), luts, outputs)
    }
  }
}

fun parseStringMap(json: String): Map<String, String> {
  val o = JSONObject(json)
  return o.keys().asSequence().associateWith { o.getString(it) }
}

/** Failure with a coded message ('@code|arg') localized by src/engine/errors.ts. */
class EngineError(message: String) : Exception(message)

// Port of src/engine/geometry.ts — keep in sync.
object Geometry {
  private val aspects = mapOf(
    "16:9" to 16.0 / 9.0, "9:16" to 9.0 / 16.0, "1:1" to 1.0, "4:5" to 4.0 / 5.0, "4:3" to 4.0 / 3.0, "2.39:1" to 2.39,
  )

  fun aspectValue(aspect: String, w: Double, h: Double) = if (aspect == "original") w / h else aspects[aspect] ?: (w / h)

  fun coverCrop(w: Double, h: Double, target: Double): FloatArray {
    val a = w / h
    if (abs(a - target) < 1e-3) return floatArrayOf(0f, 0f, 1f, 1f)
    if (a > target) {
      val cw = target / a
      return floatArrayOf(((1 - cw) / 2).toFloat(), 0f, cw.toFloat(), 1f)
    }
    val ch = a / target
    return floatArrayOf(0f, ((1 - ch) / 2).toFloat(), 1f, ch.toFloat())
  }

  private fun even(v: Double) = max(2, (v / 2).roundToInt() * 2)

  fun outputSize(w: Double, h: Double, aspect: String, resolution: String): Pair<Int, Int> {
    val crop = coverCrop(w, h, aspectValue(aspect, w, h))
    val srcW = w * crop[2]
    val srcH = h * crop[3]
    val srcShort = min(srcW, srcH)
    val short = if (resolution == "source") srcShort else min(resolution.toDoubleOrNull() ?: srcShort, srcShort)
    val scale = short / srcShort
    return Pair(even(srcW * scale), even(srcH * scale))
  }

  private val bitsPerPixel = mapOf("low" to 0.05, "medium" to 0.08, "high" to 0.12, "max" to 0.2)

  fun bitrate(w: Int, h: Int, fps: Double, quality: String, codec: String): Int {
    val eff = if (codec == "avc") 1.0 else if (codec == "hevc" || codec == "vp9") 0.65 else 0.55
    val raw = w.toDouble() * h * fps * (bitsPerPixel[quality] ?: 0.12) * eff
    return min(max(raw, 1.5e6), 120e6).roundToLong().toInt()
  }

  private val standardRates = doubleArrayOf(23.976, 24.0, 25.0, 29.97, 30.0, 48.0, 50.0, 59.94, 60.0, 120.0)

  fun snapFrameRate(rate: Double): Double {
    if (!rate.isFinite() || rate <= 0) return 30.0
    var best = standardRates[0]
    for (r in standardRates) if (abs(r - rate) < abs(best - rate)) best = r
    return if (abs(best - rate) < 1.5) best else rate.roundToInt().toDouble()
  }

  val containerCodecs = mapOf(
    "mp4" to listOf("avc", "hevc", "av1", "vp9"),
    "mov" to listOf("avc", "hevc"),
    "webm" to listOf("vp9", "av1"),
  )
}
