import ActivityKit
import BackgroundTasks
import Foundation
import UIKit

/**
 * Keeps an export running after the app leaves the foreground.
 *
 * iOS 26+: a BGContinuedProcessingTask (user-initiated, system progress UI),
 * which keeps the process alive for as long as it reports progress. GPU access
 * in the background is requested where the device offers it (today: some
 * iPads); elsewhere the engine grades on the CPU while backgrounded.
 * Older iOS: a plain background task, ~30 s of grace before suspension; the
 * render then resumes when the app returns.
 *
 * Every method is called on the main thread unless noted.
 */
final class BackgroundRun {
  private var legacyTask = UIBackgroundTaskIdentifier.invalid
  private var continued: AnyObject?  // BGContinuedProcessingTask (iOS 26+)
  private var pendingFraction: Double = 0
  private var finished = false
  private let gpu = Flag()
  /// Called (off-main) when the system or the user stops the continued task.
  private var onExpire: (() -> Void)?

  /// True when GPU work may be submitted from the background.
  var gpuGranted: Bool { gpu.isSet }

  func begin(title: String, subtitle: String, onExpire: @escaping () -> Void) {
    finished = false
    pendingFraction = 0
    gpu.set(false)
    self.onExpire = onExpire
    legacyTask = UIApplication.shared.beginBackgroundTask(withName: "lutra-render") { [weak self] in
      guard let self else { return }
      UIApplication.shared.endBackgroundTask(self.legacyTask)
      self.legacyTask = .invalid
    }
    if #available(iOS 26.0, *) { submitContinued(title: title, subtitle: subtitle) }
  }

  /// `fraction` of the whole job, 0...1. Any thread.
  func update(fraction: Double) {
    DispatchQueue.main.async { [self] in
      pendingFraction = fraction
      if #available(iOS 26.0, *), let task = continued as? BGContinuedProcessingTask {
        task.progress.completedUnitCount = Int64((min(max(fraction, 0), 1) * 1000).rounded())
      }
    }
  }

  /// Any thread.
  func end(success: Bool) {
    DispatchQueue.main.async { [self] in
      finished = true
      onExpire = nil
      if #available(iOS 26.0, *), let task = continued as? BGContinuedProcessingTask {
        task.progress.completedUnitCount = task.progress.totalUnitCount
        task.setTaskCompleted(success: success)
      }
      continued = nil
      gpu.set(false)
      if legacyTask != .invalid {
        UIApplication.shared.endBackgroundTask(legacyTask)
        legacyTask = .invalid
      }
    }
  }

  @available(iOS 26.0, *)
  private func submitContinued(title: String, subtitle: String) {
    // Each export gets its own identifier under the wildcard in
    // BGTaskSchedulerPermittedIdentifiers (app.json): "<bundle id>.export.*".
    let prefix = (Bundle.main.bundleIdentifier ?? "app.lutra.video") + ".export."
    let id = prefix + UUID().uuidString
    let wantsGPU = BGTaskScheduler.supportedResources.contains(.gpu)
    let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: .main) { [weak self] task in
      guard let task = task as? BGContinuedProcessingTask else {
        task.setTaskCompleted(success: false)
        return
      }
      guard let self, !self.finished else {
        task.setTaskCompleted(success: true)
        return
      }
      self.continued = task
      self.gpu.set(wantsGPU)
      task.progress.totalUnitCount = 1000
      task.progress.completedUnitCount = Int64((self.pendingFraction * 1000).rounded())
      task.expirationHandler = { [weak self] in
        // The user tapped stop in the system UI, or the system needs the resources back.
        guard let self else { return }
        let cancel = self.onExpire
        self.onExpire = nil
        self.gpu.set(false)
        cancel?()
      }
    }
    guard registered else { return }
    let request = BGContinuedProcessingTaskRequest(identifier: id, title: title, subtitle: subtitle)
    // Start now or not at all: a queued export would only start after this one finished.
    request.strategy = .fail
    if wantsGPU { request.requiredResources = .gpu }
    do {
      try BGTaskScheduler.shared.submit(request)
    } catch {
      // Not permitted (Low Power Mode, entitlement, quota): the legacy task still covers ~30 s.
    }
  }
}

/**
 * Mirror of expo-widgets' Live Activity attributes. ActivityKit matches
 * activities by the attributes type's name and Codable shape, so this sees the
 * activities started from JS (src/widgets) and can end them natively, where JS
 * no longer runs (the app being terminated).
 */
struct LiveActivityAttributes: ActivityAttributes {
  var url: String?

  public struct ContentState: Codable, Hashable {
    var name: String
    var props: String?
  }
}

enum LiveActivities {
  /// Ends every Live Activity of this app right away. Blocks for at most `timeout` seconds.
  static func endAllNow(timeout: TimeInterval = 2) {
    let activities = Activity<LiveActivityAttributes>.activities
    guard !activities.isEmpty else { return }
    let sem = DispatchSemaphore(value: 0)
    Task.detached {
      for activity in activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      sem.signal()
    }
    _ = sem.wait(timeout: .now() + timeout)
  }
}
