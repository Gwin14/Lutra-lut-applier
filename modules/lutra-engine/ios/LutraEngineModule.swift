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
  }
}
