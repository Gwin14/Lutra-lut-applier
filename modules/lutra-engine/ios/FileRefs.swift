import AVFoundation
import ExpoModulesCore
import Foundation
import UIKit
import UniformTypeIdentifiers

/**
 Videos picked "in place" from Files (iCloud Drive, external SSDs, SMB…): the
 app never copies them, it keeps a bookmark and re-opens the original.

 iOS grants access to such a URL only while `startAccessingSecurityScopedResource`
 is active, and only until the app quits; the bookmark brings it back after a
 relaunch, and resolving it fails while the drive is unplugged.
 */
final class FileRefs: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  static let shared = FileRefs()

  private let lock = NSLock()
  /// Bookmark (base64) -> URL currently being accessed.
  private var active: [String: URL] = [:]
  private var pending: Promise?
  private var copyMode = false

  // MARK: Picking

  func pick(multiple: Bool, copy: Bool, promise: Promise) {
    if pending != nil {
      promise.reject("E_PICKING", "A file picker is already open")
      return
    }
    guard let vc = FileRefs.topViewController() else {
      promise.reject("E_NO_VC", "No view controller to present the picker")
      return
    }
    pending = promise
    copyMode = copy
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.movie, .video, .quickTimeMovie, .mpeg4Movie], asCopy: false)
    picker.allowsMultipleSelection = multiple
    picker.delegate = self
    picker.presentationController?.delegate = self
    picker.modalPresentationStyle = .pageSheet
    vc.present(picker, animated: true)
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let promise = pending else { return }
    pending = nil
    let copy = copyMode
    DispatchQueue.global(qos: .userInitiated).async {
      var out: [[String: Any]] = []
      for url in urls {
        let scoped = url.startAccessingSecurityScopedResource()
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        var entry: [String: Any] = ["name": url.lastPathComponent, "size": size]
        if copy {
          // Copy into the app (Documents/media) and drop the reference.
          do {
            let dest = try FileRefs.copyIntoApp(url)
            entry["uri"] = dest.absoluteString
            entry["ref"] = NSNull()
          } catch {
            if scoped { url.stopAccessingSecurityScopedResource() }
            continue
          }
          if scoped { url.stopAccessingSecurityScopedResource() }
        } else {
          guard let data = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) else {
            if scoped { url.stopAccessingSecurityScopedResource() }
            continue
          }
          let ref = data.base64EncodedString()
          self.keep(ref, url, scoped)
          entry["uri"] = url.absoluteString
          entry["ref"] = ref
        }
        out.append(entry)
      }
      promise.resolve(FileRefs.json(out))
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    pending?.resolve("[]")
    pending = nil
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    pending?.resolve("[]")
    pending = nil
  }

  // MARK: Resolving

  /// `{ available, uri?, ref? }` — `ref` is set when the bookmark was refreshed.
  func resolve(_ ref: String) -> String {
    guard let data = Data(base64Encoded: ref) else { return FileRefs.json(["available": false]) }
    var stale = false
    guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else {
      // Volume not mounted, file deleted or moved out of reach.
      release(ref)
      return FileRefs.json(["available": false])
    }
    let scoped = url.startAccessingSecurityScopedResource()
    let exists = FileManager.default.fileExists(atPath: url.path) && ((try? url.checkResourceIsReachable()) ?? false)
    if !exists {
      if scoped { url.stopAccessingSecurityScopedResource() }
      release(ref)
      return FileRefs.json(["available": false])
    }
    var result: [String: Any] = ["available": true, "uri": url.absoluteString]
    var key = ref
    if stale, let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
      key = fresh.base64EncodedString()
      result["ref"] = key
      release(ref)
    }
    keep(key, url, scoped)
    return FileRefs.json(result)
  }

  func release(_ ref: String) {
    lock.lock()
    let url = active.removeValue(forKey: ref)
    lock.unlock()
    url?.stopAccessingSecurityScopedResource()
  }

  private func keep(_ ref: String, _ url: URL, _ scoped: Bool) {
    lock.lock()
    let old = active[ref]
    active[ref] = scoped ? url : nil
    lock.unlock()
    // Balance the previous start for this bookmark (each start needs one stop).
    old?.stopAccessingSecurityScopedResource()
  }

  /// Copies a referenced file into the app; the caller owns access to `uri`.
  func makeLocal(_ uri: String) throws -> String {
    guard let url = URL(string: uri) else { throw EngineError("Invalid file URL") }
    return try FileRefs.copyIntoApp(url).absoluteString
  }

  // MARK: Reading

  func stat(_ uri: String) -> Double {
    guard let url = URL(string: uri), url.isFileURL else { return -1 }
    guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path) else { return -1 }
    return (attrs[.size] as? NSNumber)?.doubleValue ?? -1
  }

  func read(_ uri: String, offset: Double, length: Int) throws -> Data {
    guard let url = URL(string: uri), url.isFileURL else { throw EngineError("Invalid file URL") }
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    try handle.seek(toOffset: UInt64(max(0, offset)))
    return try handle.read(upToCount: max(0, length)) ?? Data()
  }

  /// Duration, display size and the decoder's colour description of the first video track.
  func mediaInfo(_ uri: String) async throws -> String {
    guard let url = URL(string: uri) else { throw EngineError("Invalid file URL") }
    let asset = AVURLAsset(url: url)
    let duration = try await asset.load(.duration)
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw EngineError("@noVideoTrack") }
    let (size, transform, formats) = try await track.load(.naturalSize, .preferredTransform, .formatDescriptions)
    let rect = CGRect(origin: .zero, size: size).applying(transform)
    var out: [String: Any] = [
      "duration": duration.seconds.isFinite ? duration.seconds : 0,
      "width": abs(rect.width),
      "height": abs(rect.height),
    ]
    if let desc = formats.first {
      out["codec"] = FileRefs.fourCC(CMFormatDescriptionGetMediaSubType(desc))
      let ext = { (key: CFString) in CMFormatDescriptionGetExtension(desc, extensionKey: key) as? String }
      out["transfer"] = ext(kCMFormatDescriptionExtension_TransferFunction) ?? NSNull()
      out["primaries"] = ext(kCMFormatDescriptionExtension_ColorPrimaries) ?? NSNull()
      out["matrix"] = ext(kCMFormatDescriptionExtension_YCbCrMatrix) ?? NSNull()
      if let bits = CMFormatDescriptionGetExtension(desc, extensionKey: kCMFormatDescriptionExtension_BitsPerComponent) as? NSNumber {
        out["bitDepth"] = bits.intValue
      }
    }
    return FileRefs.json(out)
  }

  // MARK: Helpers

  private static func copyIntoApp(_ url: URL) throws -> URL {
    let docs = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let dir = docs.appendingPathComponent("media", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let ext = url.pathExtension.isEmpty ? "mov" : url.pathExtension
    let base = url.deletingPathExtension().lastPathComponent
    var dest = dir.appendingPathComponent("\(base).\(ext)")
    var n = 1
    while FileManager.default.fileExists(atPath: dest.path) {
      n += 1
      dest = dir.appendingPathComponent("\(base) \(n).\(ext)")
    }
    var coordError: NSError?
    var copyError: Error?
    NSFileCoordinator().coordinate(readingItemAt: url, options: .withoutChanges, error: &coordError) { src in
      do { try FileManager.default.copyItem(at: src, to: dest) } catch { copyError = error }
    }
    if let e = coordError ?? copyError { throw e }
    return dest
  }

  private static func fourCC(_ code: FourCharCode) -> String {
    let bytes = [24, 16, 8, 0].map { UInt8((code >> $0) & 0xff) }
    return String(bytes: bytes, encoding: .ascii)?.trimmingCharacters(in: .whitespaces) ?? ""
  }

  static func json(_ value: Any) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: value), let s = String(data: data, encoding: .utf8) else { return "null" }
    return s
  }

  private static func topViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
      ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    var vc = scene?.windows.first { $0.isKeyWindow }?.rootViewController ?? scene?.windows.first?.rootViewController
    while let presented = vc?.presentedViewController { vc = presented }
    return vc
  }
}
