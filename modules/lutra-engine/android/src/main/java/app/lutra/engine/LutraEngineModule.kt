package app.lutra.engine

import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
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

  private fun ctx() = appContext.reactContext?.applicationContext ?: throw IllegalStateException("No React context")

  override fun definition() = ModuleDefinition {
    Name("LutraEngine")

    Events("onEvent")

    AsyncFunction("probe") {
      NativeEngine.caps().toString()
    }

    // `labels` feeds the iOS background-export UI; unused here.
    Function("render") { job: String, sources: String, destinations: String, shaders: String, _: String? ->
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

    // Files picked in place (references): see FileRefs.kt.
    AsyncFunction("pickFiles") { multiple: Boolean, copy: Boolean, promise: Promise ->
      val activity = appContext.currentActivity ?: throw IllegalStateException("No activity")
      FileRefs.pick(activity, multiple, copy, promise)
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      if (payload.requestCode == FileRefs.REQUEST_CODE) FileRefs.onResult(ctx(), payload.resultCode, payload.data)
    }

    AsyncFunction("resolveRef") { ref: String -> FileRefs.resolve(ctx(), ref) }

    Function("releaseRef") { ref: String -> FileRefs.release(ctx(), ref) }

    AsyncFunction("makeLocal") { uri: String -> FileRefs.makeLocal(ctx(), uri) }

    AsyncFunction("fileSize") { uri: String -> FileRefs.size(ctx(), uri) }

    AsyncFunction("readBytes") { uri: String, offset: Double, length: Int -> FileRefs.read(ctx(), uri, offset, length) }

    AsyncFunction("mediaInfo") { uri: String -> FileRefs.mediaInfo(ctx(), uri) }

    OnDestroy {
      engine?.cancel()
    }
  }
}
