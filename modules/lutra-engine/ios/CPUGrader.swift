import CoreVideo
import Foundation
import simd

/**
 * CPU port of the grade shader's export path, used while the app is in the
 * background: iOS does not let an iPhone app submit GPU work from there, but
 * decoding and encoding (VideoToolbox) keep running.
 *
 * Mirrors MetalGrader.render: same x420 Y'CbCr input, same uniform layout
 * (MSL_SOURCE in src/engine/shader.ts), same BGRA output, same linear,
 * clamp-to-edge sampling. The view uniforms (split, false colour, zebra, bars)
 * are preview-only and ignored here; export always sends [-1, 0, 0, 0].
 */
final class CPUGrader {
  private var lut: [UInt8] = []
  private var lutKey: String?

  func setLut(key: String, payload: LutPayload) throws {
    if lutKey == key { return }
    guard let bytes = Data(base64Encoded: payload.b64), bytes.count >= payload.width * payload.height * 4 else {
      throw EngineError("Invalid LUT payload")
    }
    lut = [UInt8](bytes)
    lutKey = key
  }

  func render(source: CVPixelBuffer, into target: CVPixelBuffer, uniforms u: [Float]) throws {
    guard !lut.isEmpty, u.count >= 31 else { throw EngineError("LUT not set") }
    guard CVPixelBufferGetPlaneCount(source) >= 2 else { throw EngineError("Unexpected pixel format") }
    CVPixelBufferLockBaseAddress(source, .readOnly)
    CVPixelBufferLockBaseAddress(target, [])
    defer {
      CVPixelBufferUnlockBaseAddress(target, [])
      CVPixelBufferUnlockBaseAddress(source, .readOnly)
    }
    guard let yRaw = CVPixelBufferGetBaseAddressOfPlane(source, 0),
      let cRaw = CVPixelBufferGetBaseAddressOfPlane(source, 1),
      let oRaw = CVPixelBufferGetBaseAddress(target)
    else { throw EngineError("Pixel buffer not addressable") }

    let p = Params(
      u: u,
      y: Plane(
        base: UnsafePointer(yRaw.assumingMemoryBound(to: UInt16.self)),
        stride: CVPixelBufferGetBytesPerRowOfPlane(source, 0) / 2,
        w: CVPixelBufferGetWidthOfPlane(source, 0), h: CVPixelBufferGetHeightOfPlane(source, 0)),
      c: Plane(
        base: UnsafePointer(cRaw.assumingMemoryBound(to: UInt16.self)),
        stride: CVPixelBufferGetBytesPerRowOfPlane(source, 1) / 2,
        w: CVPixelBufferGetWidthOfPlane(source, 1), h: CVPixelBufferGetHeightOfPlane(source, 1)))
    let outW = CVPixelBufferGetWidth(target)
    let outH = CVPixelBufferGetHeight(target)
    let outStride = CVPixelBufferGetBytesPerRow(target)
    let out = oRaw.assumingMemoryBound(to: UInt8.self)

    lut.withUnsafeBufferPointer { lutBuf in
      let lutPtr = lutBuf.baseAddress!
      let bands = min(outH, ProcessInfo.processInfo.activeProcessorCount * 4)
      DispatchQueue.concurrentPerform(iterations: bands) { band in
        let y0 = band * outH / bands
        let y1 = (band + 1) * outH / bands
        for gy in y0..<y1 {
          let row = out + gy * outStride
          for gx in 0..<outW {
            let c = p.renderPixel(Float(gx) + 0.5, Float(gy) + 0.5, lut: lutPtr)
            row[gx * 4] = unorm8(c.z)
            row[gx * 4 + 1] = unorm8(c.y)
            row[gx * 4 + 2] = unorm8(c.x)
            row[gx * 4 + 3] = 255
          }
        }
      }
    }
  }
}

@inline(__always) private func unorm8(_ v: Float) -> UInt8 { UInt8(min(max(v, 0), 1) * 255 + 0.5) }
@inline(__always) private func fract(_ v: Float) -> Float { v - v.rounded(.down) }
@inline(__always) private func clamp01(_ v: SIMD3<Float>) -> SIMD3<Float> { simd_clamp(v, .zero, .one) }
@inline(__always) private func luma(_ c: SIMD3<Float>) -> Float { c.x * 0.2126 + c.y * 0.7152 + c.z * 0.0722 }

private struct Plane {
  let base: UnsafePointer<UInt16>
  let stride: Int  // in UInt16 units
  let w: Int
  let h: Int
}

private struct Params {
  let outW: Float, outH: Float
  let rawW: Float, rawH: Float
  let rot: Int
  let crop: SIMD4<Float>
  let lutN: Float, lutCols: Float, lutTexW: Int, lutTexH: Int
  let fx: SIMD4<Float>
  let time: Float, mul: Float
  let range: SIMD4<Float>
  let mat: SIMD4<Float>
  let y: Plane
  let c: Plane

  init(u: [Float], y: Plane, c: Plane) {
    outW = u[0]; outH = u[1]
    rawW = u[2]; rawH = u[3]
    rot = Int(u[4].rounded())
    crop = SIMD4(u[5], u[6], u[7], u[8])
    lutN = u[9]; lutCols = u[10]; lutTexW = Int(u[11]); lutTexH = Int(u[12])
    fx = SIMD4(u[13], u[14], u[15], u[16])
    time = u[21]; mul = u[22]
    range = SIMD4(u[23], u[24], u[25], u[26])
    mat = SIMD4(u[27], u[28], u[29], u[30])
    self.y = y
    self.c = c
  }

  /// Bilinear fetch at texel-space `x, y` (texel centres at +0.5), clamp to edge; `ch` of `chans`.
  @inline(__always)
  private func fetch(_ pl: Plane, _ x: Float, _ y: Float, chans: Int) -> SIMD2<Float> {
    let fx = x - 0.5, fy = y - 0.5
    let xf = fx.rounded(.down), yf = fy.rounded(.down)
    let ax = fx - xf, ay = fy - yf
    let xi = Int(xf), yi = Int(yf)
    let x0 = min(max(xi, 0), pl.w - 1), x1 = min(max(xi + 1, 0), pl.w - 1)
    let y0 = min(max(yi, 0), pl.h - 1), y1 = min(max(yi + 1, 0), pl.h - 1)
    let r0 = pl.base + y0 * pl.stride
    let r1 = pl.base + y1 * pl.stride
    @inline(__always) func px(_ r: UnsafePointer<UInt16>, _ x: Int) -> SIMD2<Float> {
      chans == 2 ? SIMD2(Float(r[x * 2]), Float(r[x * 2 + 1])) : SIMD2(Float(r[x]), 0)
    }
    let top = px(r0, x0) * (1 - ax) + px(r0, x1) * ax
    let bottom = px(r1, x0) * (1 - ax) + px(r1, x1) * ax
    return (top * (1 - ay) + bottom * ay) * (1.0 / 65535.0)
  }

  @inline(__always)
  func sampleFrame(_ px: SIMD2<Float>) -> SIMD3<Float> {
    let uv = px / SIMD2(rawW, rawH)
    let yy = fetch(y, uv.x * Float(y.w), uv.y * Float(y.h), chans: 1).x * range.x + range.y
    let cc = fetch(c, uv.x * Float(c.w), uv.y * Float(c.h), chans: 2) * range.z + range.w
    let cb = cc.x, cr = cc.y
    return clamp01(SIMD3(yy + mat.x * cr, yy - mat.y * cb - mat.z * cr, yy + mat.w * cb))
  }

  @inline(__always)
  func displayToRaw(_ s: SIMD2<Float>) -> SIMD2<Float> {
    let t: SIMD2<Float>
    switch rot {
    case 1: t = SIMD2(s.y, 1 - s.x)
    case 2: t = SIMD2(1 - s.x, 1 - s.y)
    case 3: t = SIMD2(1 - s.y, s.x)
    default: t = s
    }
    return t * SIMD2(rawW, rawH)
  }

  @inline(__always)
  private func lutTexel(_ px: SIMD2<Float>, _ lut: UnsafePointer<UInt8>) -> SIMD3<Float> {
    let fx = px.x - 0.5, fy = px.y - 0.5
    let xf = fx.rounded(.down), yf = fy.rounded(.down)
    let ax = fx - xf, ay = fy - yf
    let xi = Int(xf), yi = Int(yf)
    let x0 = min(max(xi, 0), lutTexW - 1), x1 = min(max(xi + 1, 0), lutTexW - 1)
    let y0 = min(max(yi, 0), lutTexH - 1), y1 = min(max(yi + 1, 0), lutTexH - 1)
    @inline(__always) func t(_ x: Int, _ y: Int) -> SIMD3<Float> {
      let i = (y * lutTexW + x) * 4
      return SIMD3(Float(lut[i]), Float(lut[i + 1]), Float(lut[i + 2]))
    }
    let top = t(x0, y0) * (1 - ax) + t(x1, y0) * ax
    let bottom = t(x0, y1) * (1 - ax) + t(x1, y1) * ax
    return (top * (1 - ay) + bottom * ay) * (1.0 / 255.0)
  }

  @inline(__always)
  func lutSample(_ c0: SIMD3<Float>, _ lut: UnsafePointer<UInt8>) -> SIMD3<Float> {
    let n = lutN, cols = lutCols
    let c = clamp01(c0)
    let bz = c.z * (n - 1)
    let b0 = bz.rounded(.down)
    let b1 = min(b0 + 1, n - 1)
    let f = bz - b0
    let rg = SIMD2(c.x, c.y) * (n - 1) + 0.5
    let row0 = ((b0 + 0.5) / cols).rounded(.down)
    let row1 = ((b1 + 0.5) / cols).rounded(.down)
    let t0 = SIMD2(b0 - row0 * cols, row0) * n
    let t1 = SIMD2(b1 - row1 * cols, row1) * n
    let a = lutTexel(t0 + rg, lut)
    let b = lutTexel(t1 + rg, lut)
    return a + (b - a) * f
  }

  @inline(__always)
  func hash12(_ p: SIMD2<Float>) -> Float {
    var p3 = SIMD3(fract(p.x * 0.1031), fract(p.y * 0.1031), fract(p.x * 0.1031))
    let d = (p3 * (SIMD3(p3.y, p3.z, p3.x) + 33.33)).sum()
    p3 += d
    return fract((p3.x + p3.y) * p3.z)
  }

  @inline(__always)
  func renderPixel(_ x: Float, _ y: Float, lut: UnsafePointer<UInt8>) -> SIMD3<Float> {
    let q = SIMD2(x / outW, y / outH)
    let s = SIMD2(crop.x, crop.y) + q * SIMD2(crop.z, crop.w)
    let rp = displayToRaw(s)
    let src = sampleFrame(rp)
    var base = src
    if fx.w > 0 {
      let dx = displayToRaw(s + SIMD2(crop.z / outW, 0)) - rp
      let dy = displayToRaw(s + SIMD2(0, crop.w / outH)) - rp
      let blur = (sampleFrame(rp + dx) + sampleFrame(rp - dx) + sampleFrame(rp + dy) + sampleFrame(rp - dy)) * 0.25
      base = clamp01(src + (src - blur) * (fx.w * 1.6))
    }
    var col = lutSample(base, lut)
    if fx.x != 0 {
      let aspect = outW / outH
      let d = (q - 0.5) * SIMD2(aspect, 1)
      let r = simd_length(d) / simd_length(SIMD2(aspect, 1) * 0.5)
      let t = min(max((r - 0.35) / (1.05 - 0.35), 0), 1)
      let v = t * t * (3 - 2 * t)
      if fx.x > 0 {
        col *= 1 - fx.x * v * 0.85
      } else {
        col += (SIMD3<Float>.one - col) * (-fx.x * v * 0.6)
      }
    }
    if fx.y > 0 {
      let cells = 540 / fx.z
      let g = (q * SIMD2(cells * outW / outH, cells)).rounded(.down)
      let nz = hash12(g + (time * 24).rounded(.down) * 17) - 0.5
      let l = luma(col)
      col = clamp01(col + nz * fx.y * 0.16 * (0.35 + 4 * l * (1 - l)))
    }
    return col * mul
  }
}
