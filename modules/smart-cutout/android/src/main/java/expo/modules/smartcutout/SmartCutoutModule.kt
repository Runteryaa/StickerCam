package expo.modules.smartcutout

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.BitmapExtractor
import com.google.mediapipe.framework.image.ByteBufferExtractor
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.components.containers.NormalizedKeypoint
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.interactivesegmenter.InteractiveSegmenter
import com.google.mediapipe.tasks.vision.interactivesegmenter.InteractiveSegmenterOptions
import com.google.mediapipe.tasks.vision.interactivesegmenter.Stroke
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * MediaPipe (MagicTouch) tabanlı, tamamen çevrimdışı akıllı nesne seçimi.
 *
 * Akış iki adımdır ve model durumludur (stateful):
 *  1. `prepareAsync`: görsel bir kez çözülür, ölçeklenir ve modele verilir.
 *     Ağır özellik çıkarımı burada yapılır, sonraki seçimler hızlıdır.
 *  2. `segmentAsync`: kullanıcının pozitif/negatif vuruşları ile maske üretir.
 *
 * Çıktı, seçilen bölgede beyaz ve güven değeriyle orantılı alfa taşıyan bir
 * maskedir. JS tarafı bu maskeyi orijinal görsele `DstIn` ile uygular.
 */
class SmartCutoutModule : Module() {
  private val lock = Any()

  private var segmenter: InteractiveSegmenter? = null
  private var preparedBitmap: Bitmap? = null
  private var preparedImage: MPImage? = null
  private var preparedWidth = 0
  private var preparedHeight = 0

  override fun definition() = ModuleDefinition {
    Name("SmartCutout")

    AsyncFunction("prepareAsync") { uri: String, maxDimension: Int ->
      synchronized(lock) {
        releaseSession()
        val context = requireContext()
        val bitmap = decodeScaled(context, uri, maxDimension.coerceIn(256, 2048))
        val segmenter = createSegmenter(context)
        val mpImage = BitmapImageBuilder(bitmap).build()

        try {
          segmenter.setImage(mpImage)
        } catch (error: Exception) {
          runCatching { mpImage.close() }
          runCatching { segmenter.close() }
          runCatching { bitmap.recycle() }
          throw SmartCutoutException("Görsel akıllı kesim modeline verilemedi.", error)
        }

        preparedBitmap = bitmap
        preparedImage = mpImage
        this@SmartCutoutModule.segmenter = segmenter
        preparedWidth = bitmap.width
        preparedHeight = bitmap.height

        mapOf(
          "width" to preparedWidth,
          "height" to preparedHeight
        )
      }
    }

    AsyncFunction("segmentAsync") { positivePoints: List<Double>, negativePoints: List<Double> ->
      synchronized(lock) {
        val segmenter = segmenter ?: throw SmartCutoutException(
          "Akıllı kesim oturumu hazır değil.",
          null
        )
        if (preparedWidth <= 0 || preparedHeight <= 0) {
          throw SmartCutoutException("Görsel boyutu okunamadı.", null)
        }

        val strokes = ArrayList<Stroke>(2)
        toStroke(positivePoints, Stroke.BrushMode.POSITIVE)?.let(strokes::add)
        toStroke(negativePoints, Stroke.BrushMode.NEGATIVE)?.let(strokes::add)

        if (strokes.isEmpty()) {
          throw SmartCutoutException("Seçim için en az bir nokta gerekli.", null)
        }

        val maskImage = try {
          segmenter.segment(strokes)
        } catch (error: Exception) {
          throw SmartCutoutException("Akıllı kesim çalıştırılamadı.", error)
        }

        try {
          writeMask(context(), maskImage)
        } finally {
          runCatching { maskImage.close() }
        }
      }
    }

    AsyncFunction("closeAsync") {
      synchronized(lock) {
        releaseSession()
      }
    }
  }

  private fun requireContext(): Context =
    appContext.reactContext ?: throw SmartCutoutException("Uygulama bağlamı hazır değil.", null)

  private fun context(): Context = requireContext()

  private fun createSegmenter(context: Context): InteractiveSegmenter {
    // Modeli APK içindeki asset'ten belleğe okuyoruz. Böylece asset'in APK'da
    // sıkıştırılmış olup olmaması fark etmez; `setModelAssetPath` bazı
    // cihazlarda sıkıştırılmış varlıklarda başarısız olabiliyor.
    val bytes = try {
      context.assets.open(MODEL_ASSET).use { it.readBytes() }
    } catch (error: Exception) {
      throw SmartCutoutException("Akıllı kesim modeli okunamadı.", error)
    }

    val buffer = java.nio.ByteBuffer.allocateDirect(bytes.size)
    buffer.put(bytes)
    buffer.rewind()

    val baseOptions = BaseOptions.builder()
      .setModelAssetBuffer(buffer)
      .build()

    val options = InteractiveSegmenterOptions.builder()
      .setBaseOptions(baseOptions)
      .build()

    return try {
      InteractiveSegmenter.createFromOptions(context, options)
    } catch (error: Exception) {
      throw SmartCutoutException("Akıllı kesim modeli yüklenemedi.", error)
    }
  }

  private fun toStroke(points: List<Double>, mode: Stroke.BrushMode): Stroke? {
    if (points.size < 2) {
      return null
    }

    val keypoints = ArrayList<NormalizedKeypoint>(points.size / 2)
    var index = 0
    while (index + 1 < points.size) {
      val x = points[index].toFloat().coerceIn(0f, 1f)
      val y = points[index + 1].toFloat().coerceIn(0f, 1f)
      keypoints.add(NormalizedKeypoint.create(x, y))
      index += 2
    }

    if (keypoints.isEmpty()) {
      return null
    }

    return Stroke.builder()
      .setBrushMode(mode)
      .setPoints(keypoints)
      .setCompleted(true)
      .build()
  }

  /**
   * Modelin güven maskesini ARGB bitmap'e çevirir.
   *
   * Maske float32 ise doğrudan okunur; aksi halde bitmap'e düşülür. Kenarlarda
   * sert bir eşik yerine dar bir geçiş bandı kullanılıyor: bu hem hayalet
   * pikselleri temizler hem de kesim kenarını yumuşak tutar.
   */
  private fun confidenceBitmap(mask: MPImage): Bitmap {
    val width = mask.width
    val height = mask.height
    if (width <= 0 || height <= 0) {
      throw SmartCutoutException("Akıllı kesim maskesi boş döndü.", null)
    }

    val confidence = readFloatMask(mask, width, height)
    if (confidence != null) {
      val pixels = IntArray(width * height)
      for (index in 0 until width * height) {
        val alpha = smoothAlpha(confidence[index])
        pixels[index] = if (alpha <= 0) {
          Color.TRANSPARENT
        } else {
          Color.argb(alpha, 255, 255, 255)
        }
      }
      return Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
    }

    val extracted = BitmapExtractor.extract(mask)
      ?: throw SmartCutoutException("Akıllı kesim maskesi okunamadı.", null)

    // Bitmap yolu yalnızca yedek: gri tonlu maskeyi alfaya çeviriyoruz.
    val pixels = IntArray(extracted.width * extracted.height)
    extracted.getPixels(pixels, 0, extracted.width, 0, 0, extracted.width, extracted.height)
    for (index in pixels.indices) {
      val pixel = pixels[index]
      val luminance = (
        (Color.red(pixel) * 0.299f) +
          (Color.green(pixel) * 0.587f) +
          (Color.blue(pixel) * 0.114f)
        ) / 255f
      val alpha = smoothAlpha(luminance)
      pixels[index] = if (alpha <= 0) Color.TRANSPARENT else Color.argb(alpha, 255, 255, 255)
    }
    if (!extracted.isRecycled) {
      extracted.recycle()
    }
    return Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
  }

  private fun readFloatMask(mask: MPImage, width: Int, height: Int): FloatArray? {
    return try {
      val buffer = ByteBufferExtractor.extract(mask, MPImage.IMAGE_FORMAT_VEC32F1)
        ?: return null
      buffer.order(ByteOrder.nativeOrder())
      val expected = width * height
      if (buffer.remaining() < expected * 4) {
        return null
      }
      val values = FloatArray(expected)
      val floats = buffer.asFloatBuffer()
      floats.get(values, 0, expected)
      values
    } catch (error: Exception) {
      null
    }
  }

  /** Güven değerini yumuşak eşikle alfa kanalına çevirir. */
  private fun smoothAlpha(confidence: Float): Int {
    val normalized = ((confidence - LOW_CONFIDENCE) / (HIGH_CONFIDENCE - LOW_CONFIDENCE))
      .coerceIn(0f, 1f)
    // Kenarı daha da yumuşatmak için hafif bir smoothstep uyguluyoruz.
    val smooth = normalized * normalized * (3f - (2f * normalized))
    return (smooth * 255f).roundToInt()
  }

  private fun writeMask(context: Context, mask: MPImage): Map<String, Any?> {
    val bitmap = confidenceBitmap(mask)
    val scaled = if (bitmap.width == preparedWidth && bitmap.height == preparedHeight) {
      bitmap
    } else {
      Bitmap.createScaledBitmap(bitmap, preparedWidth, preparedHeight, true).also {
        if (it !== bitmap) {
          bitmap.recycle()
        }
      }
    }

    val directory = File(context.cacheDir, MASK_DIRECTORY)
    if (!directory.isDirectory && !directory.mkdirs()) {
      throw SmartCutoutException("Kesim maskesi için klasör oluşturulamadı.", null)
    }

    val file = File(directory, "mask-${System.currentTimeMillis()}.png")
    try {
      FileOutputStream(file).use { output ->
        if (!scaled.compress(Bitmap.CompressFormat.PNG, 100, output)) {
          throw SmartCutoutException("Kesim maskesi yazılamadı.", null)
        }
      }
    } finally {
      if (!scaled.isRecycled) {
        scaled.recycle()
      }
    }

    return mapOf(
      "uri" to "file://" + file.absolutePath,
      "width" to preparedWidth,
      "height" to preparedHeight
    )
  }

  /**
   * Görseli EXIF yönü uygulanmış ve en uzun kenarı `maxDimension` olacak
   * şekilde çözer. JS tarafı görseli zaten yönü düzeltilmiş olarak verdiği
   * için burada ek EXIF işlemi yapılmıyor.
   */
  private fun decodeScaled(context: Context, uri: String, maxDimension: Int): Bitmap {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    val path = toFilePath(uri)

    if (path != null) {
      BitmapFactory.decodeFile(path, bounds)
    } else {
      context.contentResolver.openInputStream(android.net.Uri.parse(uri))?.use { stream ->
        BitmapFactory.decodeStream(stream, null, bounds)
      }
    }

    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      throw SmartCutoutException("Görsel açılamadı.", null)
    }

    val longest = max(bounds.outWidth, bounds.outHeight)
    var sample = 1
    while (longest / (sample * 2) >= maxDimension) {
      sample *= 2
    }

    val options = BitmapFactory.Options().apply {
      inSampleSize = sample
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }

    val decoded = if (path != null) {
      BitmapFactory.decodeFile(path, options)
    } else {
      context.contentResolver.openInputStream(android.net.Uri.parse(uri))?.use { stream ->
        BitmapFactory.decodeStream(stream, null, options)
      }
    } ?: throw SmartCutoutException("Görsel çözülemedi.", null)

    val scale = min(1f, maxDimension.toFloat() / max(decoded.width, decoded.height))
    if (scale >= 1f) {
      return decoded
    }

    val targetWidth = max(1, (decoded.width * scale).roundToInt())
    val targetHeight = max(1, (decoded.height * scale).roundToInt())
    val scaled = Bitmap.createScaledBitmap(decoded, targetWidth, targetHeight, true)
    if (scaled !== decoded) {
      decoded.recycle()
    }
    return scaled
  }

  private fun toFilePath(uri: String): String? {
    val trimmed = uri.removePrefix("file://")
    return if (trimmed.startsWith("/")) trimmed else null
  }

  private fun releaseSession() {
    segmenter?.let { runCatching { it.close() } }
    segmenter = null

    preparedImage?.let { runCatching { it.close() } }
    preparedImage = null

    preparedBitmap?.let {
      if (!it.isRecycled) {
        it.recycle()
      }
    }
    preparedBitmap = null

    preparedWidth = 0
    preparedHeight = 0
  }

  companion object {
    private const val MODEL_ASSET = "interactive_segmentation.task"
    private const val MASK_DIRECTORY = "smart-cutout"

    /** Bu değerin altındaki güven tamamen şeffaf sayılır. */
    private const val LOW_CONFIDENCE = 0.25f
    /** Bu değerin üstündeki güven tamamen opak sayılır. */
    private const val HIGH_CONFIDENCE = 0.75f
  }
}

class SmartCutoutException(message: String, cause: Throwable?) :
  CodedException(message, cause)
