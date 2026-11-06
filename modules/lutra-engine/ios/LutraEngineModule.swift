import ExpoModulesCore
import Foundation

public class LutraEngineModule: Module {
  private lazy var engine = NativeEngine { [weak self] event in
    guard let self,
      let data = try? JSONSerialization.data(withJSONObject: event),
      let json = String(data: data, encoding: .utf8)
    else { return }
    self.sendEvent("onEvent", ["json": json])
  }

  public func definition() -> ModuleDefinition {
    Name("LutraEngine")

    Events("onEvent")

    AsyncFunction("probe") { () -> String in
      let data = try JSONSerialization.data(withJSONObject: NativeEngine.caps())
      return String(data: data, encoding: .utf8) ?? "{}"
    }

    Function("render") { (job: String, sources: String, destinations: String, shaders: String) in
      let decoder = JSONDecoder()
      let parsedJob = try decoder.decode(RenderJob.self, from: Data(job.utf8))
      let parsedSources = try decoder.decode([String: String].self, from: Data(sources.utf8))
      let parsedDestinations = try decoder.decode([String: String].self, from: Data(destinations.utf8))
      let parsedShaders = try decoder.decode(EngineShaders.self, from: Data(shaders.utf8))
      self.engine.render(job: parsedJob, sources: parsedSources, destinations: parsedDestinations, shaders: parsedShaders)
    }

    Function("cancel") {
      self.engine.cancel()
    }

    // Files picked in place (references): see FileRefs.swift.
    AsyncFunction("pickFiles") { (multiple: Bool, copy: Bool, promise: Promise) in
      FileRefs.shared.pick(multiple: multiple, copy: copy, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("resolveRef") { (ref: String) -> String in
      FileRefs.shared.resolve(ref)
    }

    Function("releaseRef") { (ref: String) in
      FileRefs.shared.release(ref)
    }

    AsyncFunction("makeLocal") { (uri: String) -> String in
      try FileRefs.shared.makeLocal(uri)
    }

    AsyncFunction("fileSize") { (uri: String) -> Double in
      FileRefs.shared.stat(uri)
    }

    AsyncFunction("readBytes") { (uri: String, offset: Double, length: Int) -> Data in
      try FileRefs.shared.read(uri, offset: offset, length: length)
    }

    AsyncFunction("mediaInfo") { (uri: String) async throws -> String in
      try await FileRefs.shared.mediaInfo(uri)
    }
  }
}
