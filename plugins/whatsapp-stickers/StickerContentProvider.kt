package __PACKAGE__

import android.content.ContentProvider
import android.content.ContentValues
import android.content.res.AssetFileDescriptor
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import org.json.JSONObject
import java.io.File

/**
 * WhatsApp'ın sticker paketlerini okuyabildiği ContentProvider.
 *
 * WhatsApp'ın istediği sözleşme sabittir:
 *  - `metadata` tüm paketleri, `metadata/<id>` tek paketi,
 *  - `stickers/<id>` paketin sticker listesini döndürür,
 *  - `stickers_asset/<id>/<dosya>` sticker ve tray görsellerini açar.
 *
 * Paketler JS tarafında `filesDir/whatsapp-packs/<id>/` altına yazılır. Bu sınıf
 * yalnızca oradaki `pack.json` manifestini ve görselleri WhatsApp'a sunar.
 */
class StickerContentProvider : ContentProvider() {

  companion object {
    const val AUTHORITY = "__AUTHORITY__"

    private const val METADATA = "metadata"
    private const val STICKERS = "stickers"
    private const val STICKERS_ASSET = "stickers_asset"

    private const val PACKS_DIRECTORY = "whatsapp-packs"
    private const val PACK_MANIFEST = "pack.json"

    private const val STICKER_PACK_IDENTIFIER_IN_QUERY = "sticker_pack_identifier"
    private const val STICKER_PACK_NAME_IN_QUERY = "sticker_pack_name"
    private const val STICKER_PACK_PUBLISHER_IN_QUERY = "sticker_pack_publisher"
    private const val STICKER_PACK_ICON_IN_QUERY = "sticker_pack_icon"
    private const val ANDROID_APP_DOWNLOAD_LINK_IN_QUERY = "android_play_store_link"
    private const val IOS_APP_DOWNLOAD_LINK_IN_QUERY = "ios_app_download_link"
    private const val PUBLISHER_EMAIL = "sticker_pack_publisher_email"
    private const val PUBLISHER_WEBSITE = "sticker_pack_publisher_website"
    private const val PRIVACY_POLICY_WEBSITE = "sticker_pack_privacy_policy_website"
    private const val LICENSE_AGREEMENT_WEBSITE = "sticker_pack_license_agreement_website"
    private const val IMAGE_DATA_VERSION = "image_data_version"
    private const val AVOID_CACHE = "whatsapp_will_not_cache_stickers"
    private const val ANIMATED_STICKER_PACK = "animated_sticker_pack"

    private const val STICKER_FILE_NAME_IN_QUERY = "sticker_file_name"
    private const val STICKER_FILE_EMOJI_IN_QUERY = "sticker_emoji"
    private const val STICKER_FILE_ACCESSIBILITY_TEXT_IN_QUERY = "sticker_accessibility_text"

    private val IDENTIFIER_REGEX = Regex("^[A-Za-z0-9_-]{1,80}$")
    private val FILE_NAME_REGEX = Regex("^[A-Za-z0-9_.-]{1,80}$")
  }

  private data class StickerEntry(
    val fileName: String,
    val emojis: String,
    val accessibilityText: String
  )

  private data class Pack(
    val identifier: String,
    val name: String,
    val publisher: String,
    val publisherEmail: String,
    val publisherWebsite: String,
    val privacyPolicyWebsite: String,
    val licenseAgreementWebsite: String,
    val androidPlayStoreLink: String,
    val iosAppDownloadLink: String,
    val imageDataVersion: String,
    val avoidCache: Boolean,
    val animated: Boolean,
    val trayImageFile: String,
    val stickers: List<StickerEntry>,
    val directory: File
  )

  override fun onCreate(): Boolean = true

  private fun packsRoot(): File = File(requireNotNull(context).filesDir, PACKS_DIRECTORY)

  private fun readPacks(): List<Pack> {
    val root = packsRoot()
    if (!root.isDirectory) {
      return emptyList()
    }
    val children = root.listFiles() ?: return emptyList()
    return children
      .filter { it.isDirectory && IDENTIFIER_REGEX.matches(it.name) }
      .sortedBy { it.name }
      .mapNotNull { readPack(it) }
  }

  private fun readPack(directory: File): Pack? {
    return try {
      val manifest = File(directory, PACK_MANIFEST)
      if (!manifest.isFile) {
        return null
      }
      val json = JSONObject(manifest.readText())
      val stickerArray = json.optJSONArray("stickers") ?: return null

      val stickers = ArrayList<StickerEntry>()
      for (index in 0 until stickerArray.length()) {
        val item = stickerArray.optJSONObject(index) ?: continue
        val fileName = item.optString("imageFileName")
        if (!FILE_NAME_REGEX.matches(fileName)) {
          continue
        }
        if (!File(directory, fileName).isFile) {
          continue
        }
        val emojis = item.optString("emojis", "😀")
        stickers.add(
          StickerEntry(
            fileName = fileName,
            emojis = if (emojis.isBlank()) "😀" else emojis,
            accessibilityText = item.optString("accessibilityText", "")
          )
        )
      }
      if (stickers.isEmpty()) {
        return null
      }

      val trayImageFile = json.optString("trayImageFile", "tray.webp")
      if (!FILE_NAME_REGEX.matches(trayImageFile)) {
        return null
      }
      if (!File(directory, trayImageFile).isFile) {
        return null
      }

      Pack(
        identifier = directory.name,
        name = json.optString("name", "StickerCam").ifBlank { "StickerCam" },
        publisher = json.optString("publisher", "StickerCam").ifBlank { "StickerCam" },
        publisherEmail = json.optString("publisherEmail", ""),
        publisherWebsite = json.optString("publisherWebsite", ""),
        privacyPolicyWebsite = json.optString("privacyPolicyWebsite", ""),
        licenseAgreementWebsite = json.optString("licenseAgreementWebsite", ""),
        androidPlayStoreLink = json.optString("androidPlayStoreLink", ""),
        iosAppDownloadLink = json.optString("iosAppDownloadLink", ""),
        imageDataVersion = json.optString("imageDataVersion", "1").ifBlank { "1" },
        avoidCache = json.optBoolean("avoidCache", true),
        animated = json.optBoolean("animatedStickerPack", false),
        trayImageFile = trayImageFile,
        stickers = stickers,
        directory = directory
      )
    } catch (error: Exception) {
      null
    }
  }

  override fun query(
    uri: Uri,
    projection: Array<String>?,
    selection: String?,
    selectionArgs: Array<String>?,
    sortOrder: String?
  ): Cursor? {
    val segments = uri.pathSegments
    if (segments.isEmpty()) {
      return null
    }

    return when {
      segments[0] == METADATA && segments.size == 1 -> cursorForPacks(uri, readPacks())
      segments[0] == METADATA && segments.size == 2 ->
        cursorForPacks(uri, readPacks().filter { it.identifier == segments[1] })
      segments[0] == STICKERS && segments.size == 2 ->
        cursorForStickers(uri, readPacks().firstOrNull { it.identifier == segments[1] })
      else -> null
    }
  }

  private fun cursorForPacks(uri: Uri, packs: List<Pack>): Cursor {
    val cursor = MatrixCursor(
      arrayOf(
        STICKER_PACK_IDENTIFIER_IN_QUERY,
        STICKER_PACK_NAME_IN_QUERY,
        STICKER_PACK_PUBLISHER_IN_QUERY,
        STICKER_PACK_ICON_IN_QUERY,
        ANDROID_APP_DOWNLOAD_LINK_IN_QUERY,
        IOS_APP_DOWNLOAD_LINK_IN_QUERY,
        PUBLISHER_EMAIL,
        PUBLISHER_WEBSITE,
        PRIVACY_POLICY_WEBSITE,
        LICENSE_AGREEMENT_WEBSITE,
        IMAGE_DATA_VERSION,
        AVOID_CACHE,
        ANIMATED_STICKER_PACK
      )
    )

    for (pack in packs) {
      val row = cursor.newRow()
      row.add(pack.identifier)
      row.add(pack.name)
      row.add(pack.publisher)
      row.add(pack.trayImageFile)
      row.add(pack.androidPlayStoreLink.takeIf { it.isNotBlank() })
      row.add(pack.iosAppDownloadLink.takeIf { it.isNotBlank() })
      row.add(pack.publisherEmail.takeIf { it.isNotBlank() })
      row.add(pack.publisherWebsite.takeIf { it.isNotBlank() })
      row.add(pack.privacyPolicyWebsite.takeIf { it.isNotBlank() })
      row.add(pack.licenseAgreementWebsite.takeIf { it.isNotBlank() })
      row.add(pack.imageDataVersion)
      row.add(if (pack.avoidCache) 1 else 0)
      row.add(if (pack.animated) 1 else 0)
    }

    cursor.setNotificationUri(requireNotNull(context).contentResolver, uri)
    return cursor
  }

  private fun cursorForStickers(uri: Uri, pack: Pack?): Cursor {
    val cursor = MatrixCursor(
      arrayOf(
        STICKER_FILE_NAME_IN_QUERY,
        STICKER_FILE_EMOJI_IN_QUERY,
        STICKER_FILE_ACCESSIBILITY_TEXT_IN_QUERY
      )
    )

    if (pack != null) {
      for (sticker in pack.stickers) {
        cursor.addRow(arrayOf(sticker.fileName, sticker.emojis, sticker.accessibilityText))
      }
    }

    cursor.setNotificationUri(requireNotNull(context).contentResolver, uri)
    return cursor
  }

  override fun getType(uri: Uri): String? {
    val segments = uri.pathSegments
    if (segments.isEmpty()) {
      return null
    }
    return when {
      segments[0] == METADATA && segments.size == 1 ->
        "vnd.android.cursor.dir/vnd.$AUTHORITY.$METADATA"
      segments[0] == METADATA && segments.size == 2 ->
        "vnd.android.cursor.item/vnd.$AUTHORITY.$METADATA"
      segments[0] == STICKERS && segments.size == 2 ->
        "vnd.android.cursor.dir/vnd.$AUTHORITY.$STICKERS"
      segments[0] == STICKERS_ASSET && segments.size == 3 -> "image/webp"
      else -> null
    }
  }

  override fun openAssetFile(uri: Uri, mode: String): AssetFileDescriptor? {
    val segments = uri.pathSegments
    if (segments.size != 3 || segments[0] != STICKERS_ASSET) {
      return null
    }

    val identifier = segments[1]
    val fileName = segments[2]
    if (!IDENTIFIER_REGEX.matches(identifier) || !FILE_NAME_REGEX.matches(fileName)) {
      return null
    }

    val pack = readPacks().firstOrNull { it.identifier == identifier } ?: return null
    val isTrayImage = fileName == pack.trayImageFile
    val isSticker = pack.stickers.any { it.fileName == fileName }
    if (!isTrayImage && !isSticker) {
      return null
    }

    val file = File(pack.directory, fileName)
    if (!file.isFile) {
      return null
    }

    val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    return AssetFileDescriptor(descriptor, 0, file.length())
  }

  override fun insert(uri: Uri, values: ContentValues?): Uri? {
    throw UnsupportedOperationException("Not supported")
  }

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int {
    throw UnsupportedOperationException("Not supported")
  }

  override fun update(
    uri: Uri,
    values: ContentValues?,
    selection: String?,
    selectionArgs: Array<String>?
  ): Int {
    throw UnsupportedOperationException("Not supported")
  }
}
