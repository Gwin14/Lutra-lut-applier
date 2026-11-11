import AVFoundation
import CoreImage
import CoreMedia
import CoreVideo
import Foundation
import UIKit

/// Thread-safe counter.
final class Counter {
  private let lock = NSLock()
  private var count = 0
  func increment() { lock.lock(); count += 1; lock.unlock() }
  var value: Int { lock.lock(); defer { lock.unlock() }; return count }
}

/// Thread-safe flag.
final class Flag {
  private let lock = NSLock()
  private var value = false
  func set(_ v: Bool) { lock.lock(); value = v; lock.unlock() }
  var isSet: Bool { lock.lock(); defer { lock.unlock() }; return value }
}

/// Bridges an async AVFoundation load onto the engine thread.
func blocking<T>(_ work: @escaping () async throws -> T) throws -> T {
  let sem = DispatchSemaphore(value: 0)
  var result: Result<T, Error>!
  Task.detached {
    do { result = .success(try await work()) } catch { result = .failure(error) }
    sem.signal()
  }
  sem.wait()
  return try result.get()
}

private struct OpenClip {
  let asset: AVURLAsset
  let video: AVAssetTrack
  let audio: AVAssetTrack?
  let rawW: Double
  let rawH: Double
  let rot: Int
  let displayW: Double
  let displayH: Double
  let fps: Double
  let matrix: [Float]
}

/**
 * Native render engine (iOS). Same contract as the WebView engine
 * (engine/web/main.ts): emits EngineEvent dictionaries, but reads the source
 * clips and writes the outputs directly on disk.
 *
 * Pipeline per output: AVAssetReader (x420 Y'CbCr, no colour management)
 * -> Metal grade kernel -> AVAssetWriter (H.264/HEVC, BT.709 tags) + AAC.
 */
final class NativeEngine {
  private let emit: ([String: Any]) -> Void
  private let thread = DispatchQueue(label: "app.lutra.engine.render", qos: .userInitiated)
  private let canceled = Flag()
  private let backgrounded = Flag()
  /// Bumped on every return to the foreground, so waits that spanned a suspension are not taken for stalls.
  private let resumes = Counter()
  private var grader: MetalGrader?
  private var graderSource: String?
  /// Grades while backgrounded without GPU access (iPhone): same output as the Metal kernel.
  private let cpuGrader = CPUGrader()
  private let background = BackgroundRun()
  private let ciContext = CIContext(options: [.cacheIntermediates: false])
  private var observers: [NSObjectProtocol] = []
  /// False only for the command-line test harness, which has no UIApplication.
  private let appLifecycle: Bool

  init(appLifecycle: Bool = true, emit: @escaping ([String: Any]) -> Void) {
    self.emit = emit
    self.appLifecycle = appLifecycle
    guard appLifecycle else { return }
    let nc = NotificationCenter.default
    observers.append(nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
      self?.backgrounded.set(true)
    })
    observers.append(nc.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: nil) { [weak self] _ in
      self?.backgrounded.set(false)
      self?.resumes.increment()
    })
    observers.append(nc.addObserver(forName: UIApplication.willTerminateNotification, object: nil, queue: nil) { [weak self] _ in
      // Swiped away mid-export: nothing will ever update the Live Activity again.
      self?.canceled.set(true)
      LiveActivities.endAllNow()
    })
  }

  /// Whether this frame may go to the GPU.
  private var gpuAllowed: Bool { !backgrounded.isSet || background.gpuGranted }

  deinit {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
  }

  // MARK: caps

  static func caps() -> [String: Any] {
    let hevc = AVAssetExportSession.allExportPresets().contains(AVAssetExportPresetHEVCHighestQuality)
    let no = ["hd": false, "uhd": false]
    return [
      "backend": "native",
      "gpu": MTLCreateSystemDefaultDevice()?.name ?? "Metal",
      "webcodecs": false,
      "webgl": 0,
      "video": [
        "avc": ["hd": true, "uhd": true],
        "hevc": ["hd": hevc, "uhd": hevc],
        "vp9": no,
        "av1": no,
      ],
      "audio": ["aac": true, "opus": false],
      "userAgent": "Lutra native (\(UIDevice.current.systemName) \(UIDevice.current.systemVersion))",
    ]
  }

  // MARK: job

  func cancel() { canceled.set(true) }

  func render(
    job: RenderJob, sources: [String: String], destinations: [String: String], shaders: EngineShaders,
    labels: BackgroundLabels? = nil
  ) {
    canceled.set(false)
    if appLifecycle { backgrounded.set(UIApplication.shared.applicationState == .background) }
    thread.async { [self] in
      if appLifecycle { DispatchQueue.main.sync {
        background.begin(title: labels?.title ?? "Lutra", subtitle: labels?.subtitle ?? "") { [weak self] in
          self?.cancel()
        }
      } }
      defer { if appLifecycle { background.end(success: !canceled.isSet) } }
      do {
        if grader == nil || graderSource != shaders.msl {
          grader = try MetalGrader(source: shaders.msl)
          graderSource = shaders.msl
        }
      } catch {
        emit(["type": "outputError", "outIndex": -1, "message": "Metal: \(error.localizedDescription)"])
        emit(["type": "jobDone", "canceled": false])
        return
      }
      for (pos, out) in job.outputs.enumerated() {
        if canceled.isSet { break }
        do {
          try autoreleasepool {
            try renderOutput(job: job, out: out, sources: sources, destination: destinations[String(out.index)]) { fraction in
              if appLifecycle { background.update(fraction: (Double(pos) + fraction) / Double(job.outputs.count)) }
            }
          }
        } catch {
          if !canceled.isSet {
            let message = (error as? EngineError)?.message ?? error.localizedDescription
            emit(["type": "outputError", "outIndex": out.index, "message": message])
          }
        }
      }
      grader?.flush()
      emit(["type": "jobDone", "canceled": canceled.isSet])
    }
  }

  private func fileURL(_ uri: String) -> URL {
    if let url = URL(string: uri), url.scheme != nil { return url }
    return URL(fileURLWithPath: uri)
  }

  private func openClip(_ uri: String) throws -> OpenClip {
    let asset = AVURLAsset(url: fileURL(uri), options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    let (videos, audios) = try blocking {
      (try await asset.loadTracks(withMediaType: .video), try await asset.loadTracks(withMediaType: .audio))
    }
    guard let video = videos.first else { throw EngineError("@noVideoTrack") }
    let (size, transform, rate, formats, playable) = try blocking {
      try await video.load(.naturalSize, .preferredTransform, .nominalFrameRate, .formatDescriptions, .isPlayable)
    }
    let codec = formats.first.map { fourCC(CMFormatDescriptionGetMediaSubType($0)) } ?? ""
    if !playable { throw EngineError("@cannotDecode|\(codec)") }
    let angle = atan2(Double(transform.b), Double(transform.a)) * 180 / .pi
    let rot = ((Int((angle / 90).rounded()) % 4) + 4) % 4
    let rawW = Double(size.width)
    let rawH = Double(size.height)
    let swap = rot % 2 == 1
    // Untagged streams: SD is conventionally BT.601, HD and up BT.709.
    var matrixKey = (rawH >= 720 || rawW >= 1280) ? "709" : "601"
    if let desc = formats.first,
      let m = CMFormatDescriptionGetExtension(desc, extensionKey: kCMFormatDescriptionExtension_YCbCrMatrix) as? String
    {
      if m == (kCMFormatDescriptionYCbCrMatrix_ITU_R_2020 as String) { matrixKey = "2020" }
      else if m == (kCMFormatDescriptionYCbCrMatrix_ITU_R_601_4 as String) || m == (kCMFormatDescriptionYCbCrMatrix_SMPTE_240M_1995 as String) { matrixKey = "601" }
      else if m == (kCMFormatDescriptionYCbCrMatrix_ITU_R_709_2 as String) { matrixKey = "709" }
    }
    let matrix: [Float] =
      matrixKey == "2020" ? [1.4746, 0.16455, 0.57135, 1.8814]
      : matrixKey == "601" ? [1.402, 0.344136, 0.714136, 1.772]
      : [1.5748, 0.1873, 0.4681, 1.8556]
    return OpenClip(
      asset: asset, video: video, audio: audios.first, rawW: rawW, rawH: rawH, rot: rot,
      displayW: swap ? rawH : rawW, displayH: swap ? rawW : rawH,
      fps: Geometry.snapFrameRate(Double(rate)), matrix: matrix)
  }

  private func fourCC(_ code: FourCharCode) -> String {
    let bytes = [24, 16, 8, 0].map { UInt8((code >> $0) & 0xff) }
    return String(bytes: bytes, encoding: .ascii)?.trimmingCharacters(in: .whitespaces) ?? ""
  }

  private func pickCodec(_ out: RenderOutput) throws -> (String, AVVideoCodecType) {
    let hevc = AVAssetExportSession.allExportPresets().contains(AVAssetExportPresetHEVCHighestQuality)
    let order = [out.codec] + (Geometry.containerCodecs[out.container] ?? []).filter { $0 != out.codec }
    for c in order {
      if c == "avc" { return ("avc", .h264) }
      if c == "hevc" && hevc { return ("hevc", .hevc) }
    }
    throw EngineError("@noEncoder|\(out.container.uppercased())|")
  }

  // MARK: output

  private func renderOutput(
    job: RenderJob, out: RenderOutput, sources: [String: String], destination: String?, onFraction: (Double) -> Void
  ) throws {
    guard let grader else { throw EngineError("Metal unavailable") }
    guard let destination else { throw EngineError("no destination") }
    guard out.container != "webm" else { throw EngineError("@noEncoder|WEBM|") }
    var clips: [String: OpenClip] = [:]
    for seg in out.segments where clips[seg.clipKey] == nil {
      guard let uri = sources[seg.clipKey] else { throw EngineError("unknown file") }
      clips[seg.clipKey] = try openClip(uri)
    }
    let first = clips[out.segments[0].clipKey]!
    let fps: Double
    switch out.fps {
    case .source: fps = first.fps
    case .fixed(let v): fps = v
    }
    let (width, height) = Geometry.outputSize(first.displayW, first.displayH, out.aspect, out.resolution)
    let outAspect = Geometry.aspectValue(out.aspect, first.displayW, first.displayH)
    let (codecId, codecType) = try pickCodec(out)
    let bitrate = Geometry.bitrate(width, height, fps, out.quality, codecId)
    let hasAudio = out.audio && out.segments.contains { clips[$0.clipKey]?.audio != nil }
    let frames = out.segments.reduce(0) { $0 + max(1, Int((($1.end - $1.start) * fps).rounded())) }

    let url = fileURL(destination)
    try? FileManager.default.removeItem(at: url)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let writer = try AVAssetWriter(outputURL: url, fileType: out.container == "mov" ? .mov : .mp4)
    writer.shouldOptimizeForNetworkUse = false

    var compression: [String: Any] = [
      AVVideoAverageBitRateKey: bitrate,
      AVVideoMaxKeyFrameIntervalDurationKey: 2,
      AVVideoExpectedSourceFrameRateKey: fps,
      AVVideoAllowFrameReorderingKey: true,
    ]
    if codecType == .h264 { compression[AVVideoProfileLevelKey] = AVVideoProfileLevelH264HighAutoLevel }
    let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: codecType,
      AVVideoWidthKey: width,
      AVVideoHeightKey: height,
      AVVideoCompressionPropertiesKey: compression,
      AVVideoColorPropertiesKey: [
        AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
        AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
        AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
      ],
    ])
    videoInput.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: videoInput, sourcePixelBufferAttributes: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      kCVPixelBufferWidthKey as String: width,
      kCVPixelBufferHeightKey as String: height,
      kCVPixelBufferMetalCompatibilityKey as String: true,
      kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
    ])
    guard writer.canAdd(videoInput) else { throw EngineError("@noEncoder|\(out.container.uppercased())|\(width)×\(height)") }
    writer.add(videoInput)

    var audioInput: AVAssetWriterInput?
    if hasAudio {
      let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 48000,
        AVNumberOfChannelsKey: 2,
        AVEncoderBitRateKey: 192000,
      ])
      input.expectsMediaDataInRealTime = false
      if writer.canAdd(input) {
        writer.add(input)
        audioInput = input
      }
    }

    emit([
      "type": "outputStart", "outIndex": out.index, "width": width, "height": height, "fps": fps,
      "frames": frames, "codec": codecId, "audio": audioInput != nil ? "encode" : "none",
    ])

    guard writer.startWriting() else { throw writer.error ?? EngineError("AVAssetWriter failed to start") }
    writer.startSession(atSourceTime: .zero)
    var finished = false
    defer { if !finished { writer.cancelWriting() } }

    let timescale: CMTimeScale = 600_000
    var done = 0
    var offset = 0.0
    let t0 = CACurrentMediaTime()
    var lastProgress = 0.0
    var lastPreview = 0.0

    let audio = audioInput.map { AudioLane(input: $0, canceled: canceled) }
    for (si, seg) in out.segments.enumerated() {
      if canceled.isSet { break }
      let clip = clips[seg.clipKey]!
      guard let lut = job.luts[seg.lutKey] else { throw EngineError("missing LUT") }
      try grader.setLut(key: seg.lutKey, payload: lut)
      let segFrames = max(1, Int(((seg.end - seg.start) * fps).rounded()))
      let crop = Geometry.coverCrop(clip.displayW, clip.displayH, outAspect)
      let fx: [Float] = [Float(seg.effects.vignette / 100), Float(seg.effects.grain / 100), Float(seg.effects.grainSize), Float(seg.effects.sharpen / 100)]
      let range = CMTimeRange(
        start: CMTime(seconds: seg.start, preferredTimescale: timescale),
        end: CMTime(seconds: seg.end, preferredTimescale: timescale))

      let videoReader = try AVAssetReader(asset: clip.asset)
      videoReader.timeRange = range
      let videoOut = AVAssetReaderTrackOutput(track: clip.video, outputSettings: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange,
        kCVPixelBufferMetalCompatibilityKey as String: true,
        kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
      ])
      videoOut.alwaysCopiesSampleData = false
      guard videoReader.canAdd(videoOut) else { throw EngineError("@cannotDecode|") }
      videoReader.add(videoOut)
      guard videoReader.startReading() else { throw videoReader.error ?? EngineError("@cannotDecode|") }
      defer { if videoReader.status == .reading { videoReader.cancelReading() } }

      let segEndOut = offset + Double(segFrames) / fps
      let isLast = si == out.segments.count - 1
      audio?.begin(asset: clip.asset, track: clip.audio, range: range, segStart: seg.start, offset: offset, segEndOut: segEndOut)
      defer { audio?.end() }

      var current: CVPixelBuffer?
      var pending = videoOut.copyNextSampleBuffer()
      for k in 0..<segFrames {
        if canceled.isSet { break }
        let target = seg.start + (Double(k) + 0.5) / fps
        // Latest decoded frame at or before the target time (repeats/drops for fps changes).
        while let s = pending, CMSampleBufferGetPresentationTimeStamp(s).seconds <= target {
          if let pb = CMSampleBufferGetImageBuffer(s) { current = pb }
          pending = videoOut.copyNextSampleBuffer()
        }
        if current == nil, let s = pending, let pb = CMSampleBufferGetImageBuffer(s) { current = pb }
        guard let src = current else {
          if k == 0 { throw videoReader.error ?? EngineError("@cannotDecode|") }
          break
        }

        let local = Double(k) / fps
        let remain = Double(segFrames - k) / fps
        var mul = 1.0
        if seg.fadeIn > 0 { mul = min(mul, local / seg.fadeIn) }
        if seg.fadeOut > 0 { mul = min(mul, remain / seg.fadeOut) }
        mul = max(0, min(1, mul))

        guard let pool = adaptor.pixelBufferPool else { throw writer.error ?? EngineError("AVAssetWriter has no pixel buffer pool") }
        var dstOut: CVPixelBuffer?
        CVPixelBufferPoolCreatePixelBuffer(nil, pool, &dstOut)
        guard let dst = dstOut else { throw EngineError("Pixel buffer allocation failed") }
        CVBufferSetAttachment(dst, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(dst, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(dst, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)

        let rawW = Float(CVPixelBufferGetWidth(src))
        let rawH = Float(CVPixelBufferGetHeight(src))
        // x420 keeps 10-bit codes in the high bits of 16: code = unorm * 65535 / 64 (video range).
        let k10: Float = 65535.0 / 64.0
        let uniforms: [Float] =
          [Float(width), Float(height), rawW, rawH, Float(clip.rot)] + crop + grader.lutInfo + fx
          + [-1, 0, 0, 0, Float(offset + local), Float(mul)]
          + [k10 / 876, -64.0 / 876, k10 / 896, -512.0 / 896] + clip.matrix
        if gpuAllowed {
          do {
            try grader.render(source: src, into: dst, uniforms: uniforms)
          } catch where backgrounded.isSet {
            // Went to the background between the check and the commit: the GPU refused the work.
            try cpuGrader.setLut(key: seg.lutKey, payload: lut)
            try cpuGrader.render(source: src, into: dst, uniforms: uniforms)
          }
        } else {
          try cpuGrader.setLut(key: seg.lutKey, payload: lut)
          try cpuGrader.render(source: src, into: dst, uniforms: uniforms)
        }

        let ts = offset + Double(k) / fps
        audio?.pump(until: ts + 0.5)
        var waitStart = CACurrentMediaTime()
        var waitEpoch = resumes.value
        while !videoInput.isReadyForMoreMediaData {
          if canceled.isSet { break }
          if writer.status == .failed { throw writer.error ?? EngineError("AVAssetWriter failed") }
          if let audio, !audio.finished {
            audio.pump(until: ts + 1.5)
            // Nothing left to interleave: let the writer flush video alone.
            if isLast && audio.cursor >= AudioLane.frames(segEndOut) { audio.finish() }
          }
          if resumes.value != waitEpoch {
            // The app was suspended during this wait (no continued-processing task).
            waitEpoch = resumes.value
            waitStart = CACurrentMediaTime()
          }
          if CACurrentMediaTime() - waitStart > 15 { throw EngineError("AVAssetWriter stalled") }
          usleep(1000)
        }
        if canceled.isSet { break }
        if !adaptor.append(dst, withPresentationTime: CMTime(value: Int64((ts * Double(timescale)).rounded()), timescale: timescale)) {
          throw writer.error ?? EngineError("AVAssetWriter rejected a frame")
        }
        done += 1

        let now = CACurrentMediaTime()
        if now - lastProgress > 0.25 {
          lastProgress = now
          emit(["type": "progress", "outIndex": out.index, "frame": done, "frames": frames, "fps": Double(done) / max(now - t0, 0.001)])
          onFraction(Double(done) / Double(max(frames, 1)))
        }
        // Nobody sees the preview in the background, and Core Image would want the GPU.
        if now - lastPreview > 0.9 && !backgrounded.isSet {
          lastPreview = now
          sendPreview(dst, width: width, height: height)
        }
      }
      if canceled.isSet { break }
      audio?.pump(until: segEndOut)
      offset = segEndOut
    }

    if canceled.isSet { return }
    videoInput.markAsFinished()
    audio?.finish()
    let sem = DispatchSemaphore(value: 0)
    writer.finishWriting { sem.signal() }
    sem.wait()
    guard writer.status == .completed else { throw writer.error ?? EngineError("AVAssetWriter failed to finish") }
    finished = true
    emit(["type": "progress", "outIndex": out.index, "frame": frames, "frames": frames, "fps": Double(done) / max(CACurrentMediaTime() - t0, 0.001)])
    emit(["type": "outputDone", "outIndex": out.index, "duration": offset, "mime": out.container == "mov" ? "video/quicktime" : "video/mp4"])
  }

  private func sendPreview(_ pb: CVPixelBuffer, width: Int, height: Int) {
    let scale = 320.0 / Double(width)
    let image = CIImage(cvPixelBuffer: pb).transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    let options = [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.6]
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
      let jpeg = ciContext.jpegRepresentation(of: image, colorSpace: space, options: options)
    else { return }
    emit(["type": "preview", "dataUrl": "data:image/jpeg;base64,\(jpeg.base64EncodedString())"])
  }
}

/**
 * The output's audio track. Each segment is decoded to 48 kHz stereo PCM and
 * retimed onto the output timeline; gaps (clips without sound, short audio)
 * are filled with silence so the writer never waits on audio that will not come
 * and merged clips stay in sync.
 */
private final class AudioLane {
  static let rate: Int64 = 48000
  private let input: AVAssetWriterInput
  private let canceled: Flag
  /// End of the appended audio, in 48 kHz frames on the output timeline.
  private(set) var cursor: Int64 = 0
  private var reader: AVAssetReader?
  private var output: AVAssetReaderAudioMixOutput?
  private var pending: CMSampleBuffer?
  private var sourceDone = true
  private var shift: Int64 = 0
  private var segEnd: Int64 = 0
  private(set) var finished = false
  private var silenceFormat: CMAudioFormatDescription?

  init(input: AVAssetWriterInput, canceled: Flag) {
    self.input = input
    self.canceled = canceled
  }

  static func frames(_ seconds: Double) -> Int64 { Int64((seconds * Double(rate)).rounded()) }

  func begin(asset: AVAsset, track: AVAssetTrack?, range: CMTimeRange, segStart: Double, offset: Double, segEndOut: Double) {
    end()
    shift = AudioLane.frames(offset) - AudioLane.frames(segStart)
    segEnd = AudioLane.frames(segEndOut)
    sourceDone = true
    guard let track, let reader = try? AVAssetReader(asset: asset) else { return }
    reader.timeRange = range
    let output = AVAssetReaderAudioMixOutput(audioTracks: [track], audioSettings: [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: 48000,
      AVNumberOfChannelsKey: 2,
      AVLinearPCMBitDepthKey: 16,
      AVLinearPCMIsFloatKey: false,
      AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsNonInterleaved: false,
    ])
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else { return }
    reader.add(output)
    guard reader.startReading() else { return }
    self.reader = reader
    self.output = output
    sourceDone = false
  }

  func end() {
    if let reader, reader.status == .reading { reader.cancelReading() }
    reader = nil
    output = nil
    pending = nil
    sourceDone = true
  }

  func finish() {
    end()
    if !finished {
      finished = true
      input.markAsFinished()
    }
  }

  /// Appends audio up to `until` seconds (never past the segment end).
  func pump(until: Double) {
    let limit = min(AudioLane.frames(until), segEnd)
    while !finished && !canceled.isSet && cursor < limit {
      if !sourceDone, let output {
        guard let sample = pending ?? output.copyNextSampleBuffer() else {
          sourceDone = true
          continue
        }
        pending = nil
        let pts = CMSampleBufferGetPresentationTimeStamp(sample)
        let start = CMTimeConvertScale(pts, timescale: CMTimeScale(AudioLane.rate), method: .roundHalfAwayFromZero).value + shift
        let count = Int64(CMSampleBufferGetNumSamples(sample))
        if start + count <= cursor { continue } // before the trim point or already covered
        if start >= segEnd {
          sourceDone = true
          continue
        }
        if start > limit {
          pending = sample
          return
        }
        if start > cursor + 96 && !appendSilence(upTo: start) {
          pending = sample
          return
        }
        guard waitReady() else {
          pending = sample
          return
        }
        // Tiny overlaps (decoder priming, rounding) are absorbed by starting at the cursor.
        let at = max(start, cursor)
        if let retimed = retime(sample, to: at), input.append(retimed) {
          cursor = at + count
        } else {
          sourceDone = true
        }
      } else if !appendSilence(upTo: limit) {
        return
      }
    }
  }

  private func waitReady() -> Bool {
    var waited = 0
    while !input.isReadyForMoreMediaData && waited < 2000 && !canceled.isSet {
      usleep(1000)
      waited += 1
    }
    return input.isReadyForMoreMediaData
  }

  private func appendSilence(upTo target: Int64) -> Bool {
    while cursor < target {
      guard waitReady() else { return false }
      let n = min(Int64(1024), target - cursor)
      guard let sb = silence(frames: Int(n), at: cursor), input.append(sb) else { return false }
      cursor += n
    }
    return true
  }

  private func silence(frames: Int, at position: Int64) -> CMSampleBuffer? {
    if silenceFormat == nil {
      var asbd = AudioStreamBasicDescription(
        mSampleRate: 48000, mFormatID: kAudioFormatLinearPCM,
        mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked,
        mBytesPerPacket: 4, mFramesPerPacket: 1, mBytesPerFrame: 4, mChannelsPerFrame: 2, mBitsPerChannel: 16, mReserved: 0)
      CMAudioFormatDescriptionCreate(
        allocator: kCFAllocatorDefault, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0,
        magicCookie: nil, extensions: nil, formatDescriptionOut: &silenceFormat)
    }
    guard let silenceFormat else { return nil }
    let bytes = frames * 4
    var block: CMBlockBuffer?
    CMBlockBufferCreateWithMemoryBlock(
      allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: bytes, blockAllocator: kCFAllocatorDefault,
      customBlockSource: nil, offsetToData: 0, dataLength: bytes, flags: kCMBlockBufferAssureMemoryNowFlag, blockBufferOut: &block)
    guard let block else { return nil }
    CMBlockBufferFillDataBytes(with: 0, blockBuffer: block, offsetIntoDestination: 0, dataLength: bytes)
    var sb: CMSampleBuffer?
    CMAudioSampleBufferCreateReadyWithPacketDescriptions(
      allocator: kCFAllocatorDefault, dataBuffer: block, formatDescription: silenceFormat, sampleCount: frames,
      presentationTimeStamp: CMTime(value: position, timescale: CMTimeScale(AudioLane.rate)), packetDescriptions: nil, sampleBufferOut: &sb)
    return sb
  }

  private func retime(_ sample: CMSampleBuffer, to position: Int64) -> CMSampleBuffer? {
    var count: CMItemCount = 0
    CMSampleBufferGetSampleTimingInfoArray(sample, entryCount: 0, arrayToFill: nil, entriesNeededOut: &count)
    guard count > 0 else { return nil }
    var timing = [CMSampleTimingInfo](repeating: CMSampleTimingInfo(), count: count)
    CMSampleBufferGetSampleTimingInfoArray(sample, entryCount: count, arrayToFill: &timing, entriesNeededOut: &count)
    let delta = CMTimeSubtract(CMTime(value: position, timescale: CMTimeScale(AudioLane.rate)), timing[0].presentationTimeStamp)
    for i in 0..<count {
      timing[i].presentationTimeStamp = CMTimeAdd(timing[i].presentationTimeStamp, delta)
      timing[i].decodeTimeStamp = .invalid
    }
    var out: CMSampleBuffer?
    CMSampleBufferCreateCopyWithNewTiming(
      allocator: kCFAllocatorDefault, sampleBuffer: sample, sampleTimingEntryCount: count, sampleTimingArray: &timing, sampleBufferOut: &out)
    return out
  }
}
