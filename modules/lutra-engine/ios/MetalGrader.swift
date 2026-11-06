import CoreVideo
import Foundation
import Metal

/**
 * Runs the shared grade shader (MSL_SOURCE in src/engine/shader.ts) as a
 * compute kernel: x420 Y'CbCr planes + baked LUT in, BGRA pixel buffer out.
 * Every texture wraps an IOSurface through CVMetalTextureCache — no copies.
 */
final class MetalGrader {
  let device: MTLDevice
  private let queue: MTLCommandQueue
  private let pipeline: MTLComputePipelineState
  private var cache: CVMetalTextureCache?
  private var lutTexture: MTLTexture?
  private var lutKey: String?
  private(set) var lutInfo: [Float] = [33, 6, 198, 198]

  init(source: String) throws {
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
      throw EngineError("Metal unavailable")
    }
    self.device = device
    self.queue = queue
    let library = try device.makeLibrary(source: source, options: nil)
    guard let fn = library.makeFunction(name: "lutraGrade") else { throw EngineError("lutraGrade kernel missing") }
    pipeline = try device.makeComputePipelineState(function: fn)
    CVMetalTextureCacheCreate(kCFAllocatorDefault, nil, device, nil, &cache)
    if cache == nil { throw EngineError("CVMetalTextureCache unavailable") }
  }

  func setLut(key: String, payload: LutPayload) throws {
    if lutKey == key { return }
    guard let bytes = Data(base64Encoded: payload.b64), bytes.count >= payload.width * payload.height * 4 else {
      throw EngineError("Invalid LUT payload")
    }
    let desc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm, width: payload.width, height: payload.height, mipmapped: false)
    desc.usage = .shaderRead
    guard let tex = device.makeTexture(descriptor: desc) else { throw EngineError("LUT texture allocation failed") }
    bytes.withUnsafeBytes { raw in
      tex.replace(
        region: MTLRegionMake2D(0, 0, payload.width, payload.height),
        mipmapLevel: 0,
        withBytes: raw.baseAddress!,
        bytesPerRow: payload.width * 4)
    }
    lutTexture = tex
    lutKey = key
    lutInfo = [Float(payload.size), Float(payload.cols), Float(payload.width), Float(payload.height)]
  }

  private func texture(_ pb: CVPixelBuffer, plane: Int, format: MTLPixelFormat) throws -> (CVMetalTexture, MTLTexture) {
    let planar = CVPixelBufferIsPlanar(pb)
    let w = planar ? CVPixelBufferGetWidthOfPlane(pb, plane) : CVPixelBufferGetWidth(pb)
    let h = planar ? CVPixelBufferGetHeightOfPlane(pb, plane) : CVPixelBufferGetHeight(pb)
    let attrs = [kCVMetalTextureUsage: NSNumber(value: MTLTextureUsage([.shaderRead, .shaderWrite]).rawValue)] as CFDictionary
    var cvTex: CVMetalTexture?
    let status = CVMetalTextureCacheCreateTextureFromImage(kCFAllocatorDefault, cache!, pb, attrs, format, w, h, plane, &cvTex)
    guard status == kCVReturnSuccess, let cvTex, let tex = CVMetalTextureGetTexture(cvTex) else {
      throw EngineError("Texture from pixel buffer failed (\(status))")
    }
    return (cvTex, tex)
  }

  /// `uniforms` follows the layout documented on MSL_SOURCE.
  func render(source: CVPixelBuffer, into target: CVPixelBuffer, uniforms: [Float]) throws {
    guard let lutTexture else { throw EngineError("LUT not set") }
    let y = try texture(source, plane: 0, format: .r16Unorm)
    let c = try texture(source, plane: 1, format: .rg16Unorm)
    let out = try texture(target, plane: 0, format: .bgra8Unorm)
    guard let cmd = queue.makeCommandBuffer(), let enc = cmd.makeComputeCommandEncoder() else {
      throw EngineError("Metal command buffer unavailable")
    }
    enc.setComputePipelineState(pipeline)
    enc.setTexture(y.1, index: 0)
    enc.setTexture(c.1, index: 1)
    enc.setTexture(lutTexture, index: 2)
    enc.setTexture(out.1, index: 3)
    var u = uniforms
    enc.setBytes(&u, length: MemoryLayout<Float>.stride * u.count, index: 0)
    let tw = pipeline.threadExecutionWidth
    let th = max(1, pipeline.maxTotalThreadsPerThreadgroup / tw)
    let groups = MTLSize(width: (out.1.width + tw - 1) / tw, height: (out.1.height + th - 1) / th, depth: 1)
    enc.dispatchThreadgroups(groups, threadsPerThreadgroup: MTLSize(width: tw, height: th, depth: 1))
    enc.endEncoding()
    cmd.commit()
    cmd.waitUntilCompleted()
    withExtendedLifetime((y.0, c.0, out.0)) {}
    if let err = cmd.error { throw err }
  }

  func flush() {
    if let cache { CVMetalTextureCacheFlush(cache, 0) }
  }
}
