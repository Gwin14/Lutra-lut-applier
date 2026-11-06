import Foundation

// Mirrors src/engine/protocol.ts. Unknown keys are ignored by JSONDecoder.

struct LutPayload: Decodable {
  let size: Double
  let cols: Double
  let width: Int
  let height: Int
  let b64: String
}

struct SegmentEffects: Decodable {
  let vignette: Double
  let grain: Double
  let grainSize: Double
  let sharpen: Double
}

struct RenderSegment: Decodable {
  let clipKey: String
  let start: Double
  let end: Double
  let lutKey: String
  let effects: SegmentEffects
  let fadeIn: Double
  let fadeOut: Double
}

enum FpsChoice: Decodable {
  case source
  case fixed(Double)

  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if let v = try? c.decode(Double.self) {
      self = .fixed(v)
    } else {
      self = .source
    }
  }
}

struct RenderOutput: Decodable {
  let index: Int
  let name: String
  let container: String
  let codec: String
  let aspect: String
  let resolution: String
  let fps: FpsChoice
  let quality: String
  let audio: Bool
  let segments: [RenderSegment]
}

struct RenderJob: Decodable {
  let id: String
  let luts: [String: LutPayload]
  let outputs: [RenderOutput]
}

struct EngineShaders: Decodable {
  let msl: String
}

/** Engine failure with a coded message ('@code|arg') localized by src/engine/errors.ts. */
struct EngineError: Error, CustomStringConvertible {
  let message: String
  init(_ message: String) { self.message = message }
  var description: String { message }
}

// Port of src/engine/geometry.ts — keep in sync.
enum Geometry {
  static let aspects: [String: Double] = [
    "16:9": 16.0 / 9.0, "9:16": 9.0 / 16.0, "1:1": 1, "4:5": 4.0 / 5.0, "4:3": 4.0 / 3.0, "2.39:1": 2.39,
  ]

  static func aspectValue(_ aspect: String, _ w: Double, _ h: Double) -> Double {
    aspect == "original" ? w / h : (aspects[aspect] ?? w / h)
  }

  static func coverCrop(_ w: Double, _ h: Double, _ target: Double) -> [Float] {
    let a = w / h
    if abs(a - target) < 1e-3 { return [0, 0, 1, 1] }
    if a > target {
      let cw = target / a
      return [Float((1 - cw) / 2), 0, Float(cw), 1]
    }
    let ch = a / target
    return [0, Float((1 - ch) / 2), 1, Float(ch)]
  }

  static func even(_ v: Double) -> Int { max(2, Int((v / 2).rounded()) * 2) }

  static func outputSize(_ w: Double, _ h: Double, _ aspect: String, _ resolution: String) -> (Int, Int) {
    let crop = coverCrop(w, h, aspectValue(aspect, w, h))
    let srcW = w * Double(crop[2])
    let srcH = h * Double(crop[3])
    let srcShort = min(srcW, srcH)
    let short = resolution == "source" ? srcShort : min(Double(resolution) ?? srcShort, srcShort)
    let scale = short / srcShort
    return (even(srcW * scale), even(srcH * scale))
  }

  static let bitsPerPixel: [String: Double] = ["low": 0.05, "medium": 0.08, "high": 0.12, "max": 0.2]

  static func bitrate(_ w: Int, _ h: Int, _ fps: Double, _ quality: String, _ codec: String) -> Int {
    let eff = codec == "avc" ? 1.0 : (codec == "hevc" || codec == "vp9") ? 0.65 : 0.55
    let raw = Double(w * h) * fps * (bitsPerPixel[quality] ?? 0.12) * eff
    return Int(min(max(raw, 1.5e6), 120e6).rounded())
  }

  static let standardRates: [Double] = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120]

  static func snapFrameRate(_ rate: Double) -> Double {
    if !rate.isFinite || rate <= 0 { return 30 }
    var best = standardRates[0]
    for r in standardRates where abs(r - rate) < abs(best - rate) { best = r }
    return abs(best - rate) < 1.5 ? best : rate.rounded()
  }

  static let containerCodecs: [String: [String]] = [
    "mp4": ["avc", "hevc", "av1", "vp9"],
    "mov": ["avc", "hevc"],
    "webm": ["vp9", "av1"],
  ]
}
