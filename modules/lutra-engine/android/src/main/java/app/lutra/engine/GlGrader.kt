package app.lutra.engine

import android.graphics.Bitmap
import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.view.Surface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/**
 * EGL + GLES 2 host for the shared grade shader (GLSL_FRAGMENT_OES in
 * src/engine/shader.ts). Decoders render into [decoderSurface] (an external
 * OES texture); the graded frame is drawn straight into the encoder's input
 * surface, so frames never leave the GPU.
 *
 * Must be created and used on a single thread.
 */
class GlGrader(vertexSrc: String, fragmentSrc: String) {
  private val display: EGLDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
  private val config: EGLConfig
  private val context: EGLContext
  private val pbuffer: EGLSurface
  private val program: Int
  private val loc = HashMap<String, Int>()
  private val quad: FloatBuffer
  private val oesTex: Int
  private val lutTex: Int
  private var lutKey: String? = null
  var lutInfo = floatArrayOf(33f, 6f, 198f, 198f)
    private set

  private val frameThread = HandlerThread("lutra-frames").apply { start() }
  private val frameLock = Object()
  private var frameAvailable = false
  val surfaceTexture: SurfaceTexture
  val decoderSurface: Surface
  val stMatrix = FloatArray(16)

  private var previewFbo = 0
  private var previewTex = 0
  private var previewW = 0
  private var previewH = 0

  init {
    val version = IntArray(2)
    check(EGL14.eglInitialize(display, version, 0, version, 1)) { "eglInitialize failed" }
    val attribs = intArrayOf(
      EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
      EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
      EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT or EGL14.EGL_PBUFFER_BIT,
      EGL_RECORDABLE_ANDROID, 1,
      EGL14.EGL_NONE,
    )
    val configs = arrayOfNulls<EGLConfig>(1)
    val count = IntArray(1)
    check(EGL14.eglChooseConfig(display, attribs, 0, configs, 0, 1, count, 0) && count[0] > 0) { "No EGL config" }
    config = configs[0]!!
    context = EGL14.eglCreateContext(display, config, EGL14.EGL_NO_CONTEXT, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
    check(context != EGL14.EGL_NO_CONTEXT) { "eglCreateContext failed" }
    pbuffer = EGL14.eglCreatePbufferSurface(display, config, intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0)
    makeCurrent(pbuffer)

    program = link(vertexSrc, fragmentSrc)
    for (n in listOf("uOut", "uRaw", "uRot", "uCrop", "uLut", "uFx", "uView", "uMisc", "uLutTex", "uFrameTex", "uStMatrix")) {
      loc[n] = GLES20.glGetUniformLocation(program, n)
    }
    quad = ByteBuffer.allocateDirect(6 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply {
      put(floatArrayOf(-1f, -1f, 3f, -1f, -1f, 3f))
      position(0)
    }
    val tex = IntArray(2)
    GLES20.glGenTextures(2, tex, 0)
    oesTex = tex[0]
    lutTex = tex[1]
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTex)
    params(GLES11Ext.GL_TEXTURE_EXTERNAL_OES)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, lutTex)
    params(GLES20.GL_TEXTURE_2D)

    surfaceTexture = SurfaceTexture(oesTex)
    surfaceTexture.setOnFrameAvailableListener({
      synchronized(frameLock) {
        frameAvailable = true
        frameLock.notifyAll()
      }
    }, Handler(frameThread.looper))
    decoderSurface = Surface(surfaceTexture)
  }

  private fun params(target: Int) {
    GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
  }

  private fun compile(type: Int, src: String): Int {
    val s = GLES20.glCreateShader(type)
    GLES20.glShaderSource(s, src)
    GLES20.glCompileShader(s)
    val ok = IntArray(1)
    GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0)
    if (ok[0] == 0) throw EngineError("Shader: " + GLES20.glGetShaderInfoLog(s))
    return s
  }

  private fun link(vertexSrc: String, fragmentSrc: String): Int {
    val p = GLES20.glCreateProgram()
    GLES20.glAttachShader(p, compile(GLES20.GL_VERTEX_SHADER, vertexSrc))
    GLES20.glAttachShader(p, compile(GLES20.GL_FRAGMENT_SHADER, fragmentSrc))
    GLES20.glBindAttribLocation(p, 0, "aPos")
    GLES20.glLinkProgram(p)
    val ok = IntArray(1)
    GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, ok, 0)
    if (ok[0] == 0) throw EngineError("Link: " + GLES20.glGetProgramInfoLog(p))
    return p
  }

  fun makeCurrent(surface: EGLSurface) {
    check(EGL14.eglMakeCurrent(display, surface, surface, context)) { "eglMakeCurrent failed" }
  }

  fun createWindowSurface(surface: Surface): EGLSurface {
    val s = EGL14.eglCreateWindowSurface(display, config, surface, intArrayOf(EGL14.EGL_NONE), 0)
    check(s != EGL14.EGL_NO_SURFACE) { "eglCreateWindowSurface failed" }
    return s
  }

  fun releaseWindowSurface(surface: EGLSurface) {
    makeCurrent(pbuffer)
    EGL14.eglDestroySurface(display, surface)
  }

  fun present(surface: EGLSurface, ptsNs: Long) {
    EGLExt.eglPresentationTimeANDROID(display, surface, ptsNs)
    EGL14.eglSwapBuffers(display, surface)
  }

  fun setLut(key: String, lut: LutPayload) {
    if (lutKey == key) return
    val bytes = Base64.decode(lut.b64, Base64.DEFAULT)
    if (bytes.size < lut.width * lut.height * 4) throw EngineError("Invalid LUT payload")
    val buf = ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).put(bytes)
    buf.position(0)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE1)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, lutTex)
    GLES20.glPixelStorei(GLES20.GL_UNPACK_ALIGNMENT, 1)
    GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, lut.width, lut.height, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, buf)
    lutKey = key
    lutInfo = floatArrayOf(lut.size, lut.cols, lut.width.toFloat(), lut.height.toFloat())
  }

  /** Waits for the decoder's next frame and latches it into the OES texture. */
  fun awaitFrame(timeoutMs: Long = 2500): Boolean {
    synchronized(frameLock) {
      val deadline = System.currentTimeMillis() + timeoutMs
      while (!frameAvailable) {
        val left = deadline - System.currentTimeMillis()
        if (left <= 0) return false
        frameLock.wait(left)
      }
      frameAvailable = false
    }
    surfaceTexture.updateTexImage()
    surfaceTexture.getTransformMatrix(stMatrix)
    return true
  }

  class Uniforms(
    val rawW: Float,
    val rawH: Float,
    val rot: Float,
    val crop: FloatArray,
    val fx: FloatArray,
    val time: Float,
    val mul: Float,
  )

  fun draw(width: Int, height: Int, u: Uniforms) {
    GLES20.glViewport(0, 0, width, height)
    GLES20.glUseProgram(program)
    GLES20.glEnableVertexAttribArray(0)
    GLES20.glVertexAttribPointer(0, 2, GLES20.GL_FLOAT, false, 0, quad)
    GLES20.glUniform2f(loc["uOut"]!!, width.toFloat(), height.toFloat())
    GLES20.glUniform2f(loc["uRaw"]!!, u.rawW, u.rawH)
    GLES20.glUniform1f(loc["uRot"]!!, u.rot)
    GLES20.glUniform4fv(loc["uCrop"]!!, 1, u.crop, 0)
    GLES20.glUniform4fv(loc["uLut"]!!, 1, lutInfo, 0)
    GLES20.glUniform4fv(loc["uFx"]!!, 1, u.fx, 0)
    GLES20.glUniform4f(loc["uView"]!!, -1f, 0f, 0f, 0f)
    GLES20.glUniform2f(loc["uMisc"]!!, u.time, u.mul)
    GLES20.glUniformMatrix4fv(loc["uStMatrix"]!!, 1, false, stMatrix, 0)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTex)
    GLES20.glUniform1i(loc["uFrameTex"]!!, 0)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE1)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, lutTex)
    GLES20.glUniform1i(loc["uLutTex"]!!, 1)
    GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, 3)
  }

  /** Renders a small JPEG of the current frame (off-screen) as a data URL. */
  fun previewDataUrl(outW: Int, outH: Int, u: Uniforms): String? {
    val w = 320
    val h = maxOf(2, Math.round(outH.toFloat() / outW * w))
    if (previewFbo == 0 || previewW != w || previewH != h) {
      if (previewFbo != 0) {
        GLES20.glDeleteFramebuffers(1, intArrayOf(previewFbo), 0)
        GLES20.glDeleteTextures(1, intArrayOf(previewTex), 0)
      }
      val ids = IntArray(1)
      GLES20.glGenTextures(1, ids, 0)
      previewTex = ids[0]
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, previewTex)
      params(GLES20.GL_TEXTURE_2D)
      GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, w, h, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null)
      GLES20.glGenFramebuffers(1, ids, 0)
      previewFbo = ids[0]
      GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, previewFbo)
      GLES20.glFramebufferTexture2D(GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, previewTex, 0)
      previewW = w
      previewH = h
    }
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, previewFbo)
    draw(w, h, u)
    val buf = ByteBuffer.allocateDirect(w * h * 4).order(ByteOrder.nativeOrder())
    GLES20.glReadPixels(0, 0, w, h, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, buf)
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
    buf.position(0)
    return try {
      val raw = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      raw.copyPixelsFromBuffer(buf)
      // GL rows start at the bottom.
      val m = android.graphics.Matrix().apply { preScale(1f, -1f) }
      val bmp = Bitmap.createBitmap(raw, 0, 0, w, h, m, false)
      val out = java.io.ByteArrayOutputStream()
      bmp.compress(Bitmap.CompressFormat.JPEG, 60, out)
      raw.recycle()
      bmp.recycle()
      "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    } catch (e: Exception) {
      null
    }
  }

  fun release() {
    try {
      decoderSurface.release()
      surfaceTexture.release()
    } catch (_: Exception) {}
    frameThread.quitSafely()
    EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
    EGL14.eglDestroySurface(display, pbuffer)
    EGL14.eglDestroyContext(display, context)
    EGL14.eglTerminate(display)
  }

  companion object {
    private const val EGL_RECORDABLE_ANDROID = 0x3142
  }
}
