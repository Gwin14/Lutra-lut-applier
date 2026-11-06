package app.lutra.engine

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.kotlin.Promise
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream

/**
 * Videos picked "in place" through the Storage Access Framework (USB drives,
 * SD cards, cloud providers): the app keeps a persistable read grant on the
 * document URI instead of copying the file. The URI itself is the reference.
 */
object FileRefs {
  const val REQUEST_CODE = 0x4c75 // "Lu"

  private var pending: Promise? = null
  private var copyMode = false

  fun pick(activity: Activity, multiple: Boolean, copy: Boolean, promise: Promise) {
    if (pending != null) {
      promise.reject("E_PICKING", "A file picker is already open", null)
      return
    }
    pending = promise
    copyMode = copy
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "video/*"
      putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    }
    activity.startActivityForResult(intent, REQUEST_CODE)
  }

  fun onResult(context: Context, resultCode: Int, data: Intent?) {
    val promise = pending ?: return
    pending = null
    if (resultCode != Activity.RESULT_OK || data == null) {
      promise.resolve("[]")
      return
    }
    val uris = mutableListOf<Uri>()
    data.clipData?.let { clip -> for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri) }
    if (uris.isEmpty()) data.data?.let { uris.add(it) }
    val copy = copyMode
    Thread {
      val out = JSONArray()
      for (uri in uris) {
        try {
          val (name, size) = describe(context, uri)
          val entry = JSONObject().put("name", name).put("size", size)
          if (copy) {
            entry.put("uri", copyIntoApp(context, uri, name)).put("ref", JSONObject.NULL)
          } else {
            try {
              context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } catch (_: SecurityException) {
              // Provider without persistable grants: usable for this session only.
            }
            entry.put("uri", uri.toString()).put("ref", uri.toString())
          }
          out.put(entry)
        } catch (_: Exception) {
        }
      }
      promise.resolve(out.toString())
    }.start()
  }

  /** `{ available, uri? }`. Content URIs don't move, so the reference never needs refreshing. */
  fun resolve(context: Context, ref: String): String {
    val ok = try {
      context.contentResolver.openFileDescriptor(Uri.parse(ref), "r")?.use { true } ?: false
    } catch (_: Exception) {
      false
    }
    return JSONObject().put("available", ok).apply { if (ok) put("uri", ref) }.toString()
  }

  fun release(context: Context, ref: String) {
    try {
      context.contentResolver.releasePersistableUriPermission(Uri.parse(ref), Intent.FLAG_GRANT_READ_URI_PERMISSION)
    } catch (_: Exception) {
    }
  }

  fun makeLocal(context: Context, uri: String): String {
    val parsed = Uri.parse(uri)
    val (name, _) = describe(context, parsed)
    return copyIntoApp(context, parsed, name)
  }

  fun size(context: Context, uri: String): Double {
    return try {
      if (uri.startsWith("file://") || uri.startsWith("/")) {
        val f = File(filePath(uri))
        if (f.exists()) f.length().toDouble() else -1.0
      } else {
        context.contentResolver.openFileDescriptor(Uri.parse(uri), "r")?.use { it.statSize.toDouble() } ?: -1.0
      }
    } catch (_: Exception) {
      -1.0
    }
  }

  fun read(context: Context, uri: String, offset: Double, length: Int): ByteArray {
    val pfd = if (uri.startsWith("file://") || uri.startsWith("/")) null else context.contentResolver.openFileDescriptor(Uri.parse(uri), "r")
    val stream = if (pfd != null) FileInputStream(pfd.fileDescriptor) else FileInputStream(filePath(uri))
    try {
      val channel = stream.channel
      channel.position(offset.toLong().coerceAtLeast(0))
      val buf = java.nio.ByteBuffer.allocate(length.coerceAtLeast(0))
      while (buf.hasRemaining()) {
        if (channel.read(buf) <= 0) break
      }
      return buf.array().copyOf(buf.position())
    } finally {
      stream.close()
      pfd?.close()
    }
  }

  /** Duration, display size and the decoder's colour description of the first video track. */
  fun mediaInfo(context: Context, uri: String): String {
    val out = JSONObject()
    val ex: MediaExtractor = openExtractor(context, uri)
    try {
      for (i in 0 until ex.trackCount) {
        val f = ex.getTrackFormat(i)
        val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
        if (!mime.startsWith("video/")) continue
        out.put("codec", mime)
        if (f.containsKey(MediaFormat.KEY_COLOR_TRANSFER)) {
          out.put("transfer", when (f.getInteger(MediaFormat.KEY_COLOR_TRANSFER)) {
            MediaFormat.COLOR_TRANSFER_HLG -> "hlg"
            MediaFormat.COLOR_TRANSFER_ST2084 -> "pq"
            MediaFormat.COLOR_TRANSFER_SDR_VIDEO -> "709"
            else -> "other"
          })
        }
        if (f.containsKey(MediaFormat.KEY_COLOR_STANDARD)) {
          out.put("primaries", when (f.getInteger(MediaFormat.KEY_COLOR_STANDARD)) {
            MediaFormat.COLOR_STANDARD_BT2020 -> "2020"
            MediaFormat.COLOR_STANDARD_BT709 -> "709"
            else -> "other"
          })
        }
        break
      }
    } finally {
      ex.release()
    }
    val mmr = MediaMetadataRetriever()
    try {
      if (uri.startsWith("file://") || uri.startsWith("/")) mmr.setDataSource(filePath(uri)) else mmr.setDataSource(context, Uri.parse(uri))
      val w = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toDoubleOrNull() ?: 0.0
      val h = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toDoubleOrNull() ?: 0.0
      val rot = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      val swap = rot % 180 != 0
      out.put("width", if (swap) h else w).put("height", if (swap) w else h)
      out.put("duration", (mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 0.0) / 1000.0)
    } catch (_: Exception) {
    } finally {
      mmr.release()
    }
    return out.toString()
  }

  private fun describe(context: Context, uri: Uri): Pair<String, Long> {
    var name = uri.lastPathSegment ?: "video"
    var size = 0L
    try {
      context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          c.getString(0)?.let { name = it }
          if (!c.isNull(1)) size = c.getLong(1)
        }
      }
    } catch (_: Exception) {
    }
    return name to size
  }

  private fun copyIntoApp(context: Context, uri: Uri, name: String): String {
    val dir = File(context.filesDir, "media").apply { mkdirs() }
    val dot = name.lastIndexOf('.')
    val base = if (dot > 0) name.substring(0, dot) else name
    val ext = if (dot > 0) name.substring(dot + 1) else "mp4"
    var dest = File(dir, "$base.$ext")
    var n = 1
    while (dest.exists()) {
      n += 1
      dest = File(dir, "$base $n.$ext")
    }
    context.contentResolver.openInputStream(uri)?.use { input -> dest.outputStream().use { input.copyTo(it, 1 shl 20) } }
      ?: throw EngineError("Cannot open $uri")
    return Uri.fromFile(dest).toString()
  }
}
