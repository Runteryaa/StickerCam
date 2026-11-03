package expo.modules.shareintent

import android.content.Intent
import android.net.Uri
import android.os.Parcelable
import android.provider.OpenableColumns
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.Locale

/**
 * Diğer uygulamalardan gelen `ACTION_SEND` görsellerini karşılar.
 *
 * Android, paylaşılan dosyayı geçici bir `content://` izniyle verir; bu izin
 * uygulama arka plana geçtiğinde kaybolabilir. Bu yüzden gelen baytlar hemen
 * uygulamanın cache dizinine kopyalanır ve JS tarafına `file://` uri olarak
 * verilir.
 */
class ShareIntentModule : Module() {
  private var pendingIntent: Intent? = null
  private var coldStartChecked = false

  override fun definition() = ModuleDefinition {
    Name("ShareIntent")

    Events("onShareReceived")

    OnCreate {
      captureInitialIntent()
    }

    OnNewIntent { intent ->
      if (isShareIntent(intent)) {
        pendingIntent = intent
        sendEvent("onShareReceived")
      }
    }

    AsyncFunction("consumeSharedImagesAsync") {
      captureInitialIntent()
      val intent = pendingIntent
      pendingIntent = null
      if (intent == null) {
        emptyList<Map<String, Any?>>()
      } else {
        copySharedImages(intent)
      }
    }
  }

  private fun captureInitialIntent() {
    if (coldStartChecked) {
      return
    }
    coldStartChecked = true
    val intent = appContext.currentActivity?.intent ?: return
    if (isShareIntent(intent)) {
      pendingIntent = intent
    }
  }

  private fun isShareIntent(intent: Intent?): Boolean {
    if (intent == null) {
      return false
    }
    val action = intent.action
    if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) {
      return false
    }
    val type = intent.type
    return type != null && type.startsWith("image/")
  }

  @Suppress("DEPRECATION")
  private fun extractUris(intent: Intent): List<Uri> {
    val uris = ArrayList<Uri>()

    if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
      val list = intent.getParcelableArrayListExtra<Parcelable>(Intent.EXTRA_STREAM)
      if (list != null) {
        for (item in list) {
          if (item is Uri) {
            uris.add(item)
          }
        }
      }
    } else {
      val single = intent.getParcelableExtra<Parcelable>(Intent.EXTRA_STREAM)
      if (single is Uri) {
        uris.add(single)
      }
    }

    if (uris.isEmpty()) {
      val clip = intent.clipData
      if (clip != null) {
        for (index in 0 until clip.itemCount) {
          val uri = clip.getItemAt(index).uri
          if (uri != null) {
            uris.add(uri)
          }
        }
      }
    }

    return uris.distinct()
  }

  private fun copySharedImages(intent: Intent): List<Map<String, Any?>> {
    val context = appContext.reactContext ?: return emptyList()
    val directory = File(context.cacheDir, "shared-images")
    if (!directory.isDirectory && !directory.mkdirs()) {
      return emptyList()
    }

    val results = ArrayList<Map<String, Any?>>()
    val uris = extractUris(intent)

    for ((index, uri) in uris.withIndex()) {
      val mimeType = try {
        context.contentResolver.getType(uri) ?: intent.type
      } catch (error: Exception) {
        intent.type
      }
      val fileName = displayName(uri)
      val extension = extensionFor(mimeType, fileName)
      val target = File(
        directory,
        "shared-${System.currentTimeMillis()}-$index.$extension"
      )

      val copied = try {
        context.contentResolver.openInputStream(uri)?.use { input ->
          target.outputStream().use { output -> input.copyTo(output) }
        }
        target.isFile && target.length() > 0
      } catch (error: Exception) {
        false
      }

      if (!copied) {
        target.delete()
        continue
      }

      results.add(
        mapOf(
          "uri" to Uri.fromFile(target).toString(),
          "mimeType" to (mimeType ?: ""),
          "fileName" to (fileName ?: target.name)
        )
      )
    }

    return results
  }

  private fun displayName(uri: Uri): String? {
    val context = appContext.reactContext ?: return null
    return try {
      context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { cursor ->
          if (!cursor.moveToFirst()) {
            null
          } else {
            val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (column < 0) null else cursor.getString(column)
          }
        }
    } catch (error: Exception) {
      null
    }
  }

  private fun extensionFor(mimeType: String?, fileName: String?): String {
    val fromName = fileName
      ?.substringAfterLast('.', "")
      ?.lowercase(Locale.US)
      ?.takeIf { it.isNotEmpty() && it.length <= 5 && it.all { character -> character.isLetterOrDigit() } }
    if (fromName != null) {
      return fromName
    }

    return when (mimeType?.lowercase(Locale.US)) {
      "image/png" -> "png"
      "image/webp" -> "webp"
      "image/gif" -> "gif"
      "image/bmp" -> "bmp"
      "image/heic", "image/heif" -> "heic"
      "image/jpeg", "image/jpg" -> "jpg"
      else -> "img"
    }
  }
}
