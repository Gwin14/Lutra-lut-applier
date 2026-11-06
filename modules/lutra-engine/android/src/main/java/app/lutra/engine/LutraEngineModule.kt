package app.lutra.engine

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

class LutraEngineModule : Module() {
  private var engine: NativeEngine? = null

  private fun engine(): NativeEngine {
    engine?.let { return it }
    val ctx = appContext.reactContext?.applicationContext ?: throw IllegalStateException("No React context")
    return NativeEngine(ctx) { json -> sendEvent("onEvent", mapOf("json" to json)) }.also { engine = it }
  }

  override fun definition() = ModuleDefinition {
    Name("LutraEngine")

    Events("onEvent")

    AsyncFunction("probe") {
      NativeEngine.caps().toString()
    }

    Function("render") { job: String, sources: String, destinations: String, shaders: String ->
      val s = JSONObject(shaders)
      engine().render(
        RenderJob.parse(job),
        parseStringMap(sources),
        parseStringMap(destinations),
        s.getString("glslVertex"),
        s.getString("glslFragment"),
      )
    }

    Function("cancel") {
      engine?.cancel()
    }

    OnDestroy {
      engine?.cancel()
    }
  }
}
