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
import java.nio.ByteBuffer
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
  /** Model yüklenemediyse nedeni; kullanıcıya gösterilir. */
  private var loadError: String? = null

  override fun definition() = ModuleDefinition {
    Name("SmartCutout")

    AsyncFunction("prepareAsync") { uri: String, maxDimension: Int ->
      synchronized(lock) {
        releaseSession()
        val context = requireContext()
        val bitmap = decodeScaled(context, uri, maxDimension.coerceIn(256, 2048))

        preparedBitmap = bitmap
        preparedWidth = bitmap.width
        preparedHeight = bitmap.height

        // Modeli şimdi yüklemeye çalışıyoruz. Başarısız olursa görseli
        // bırakıp ilk dokunuşta tekrar deniyoruz: bazı cihazlarda ilk deneme
        // bellek baskısı yüzünden düşebiliyor.
        attachSegmenter(context, bitmap)

        mapOf(
          "width" to preparedWidth,
          "height" to preparedHeight,
          "modelLoaded" to (segmenter != null),
          "error" to loadError
        )
      }
    }

    AsyncFunction("segmentAsync") { positivePoints: List<Double>, negativePoints: List<Double> ->
      synchronized(lock) {
        val bitmap = preparedBitmap ?: throw SmartCutoutException(
          "Görsel akıllı kesim için hazırlanmadı.",
          null
        )
        if (preparedWidth <= 0 || preparedHeight <= 0) {
          throw SmartCutoutException("Görsel boyutu okunamadı.", null)
        }

        // Model hazırlık sırasında yüklenemediyse burada bir kez daha dene.
        if (segmenter == null) {
          attachSegmenter(context(), bitmap)
        }

        val segmenter = segmenter ?: throw SmartCutoutException(
          "Akıllı kesim modeli yüklenemedi: ${loadError ?: "bilinmeyen hata"}",
          null
        )

        // Her dokunuş/sürükleme ayrı bir vuruş olarak gönderilir; aksi halde
        // model iki uzak noktayı tek bir fırça çizgisi sanıp yanlış bölge seçer.
        val strokes = ArrayList<Stroke>(4)
        strokes.addAll(toStrokes(positivePoints, Stroke.BrushMode.POSITIVE))
        strokes.addAll(toStrokes(negativePoints, Stroke.BrushMode.NEGATIVE))

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

  /**
   * Modeli yükler ve hazır görsele bağlar.
   *
   * Üç yol sırayla denenir; her biri farklı cihaz/APK yapılandırmasında
   * çalışabildiği için biri düşerse diğerine geçilir. Hata mesajları
   * birleştirilip `loadError` içinde tutulur, böylece kullanıcı gerçek nedeni
   * görebilir.
   *
   *   1. `setModelAssetPath`: asset sıkıştırılmamışsa en verimli yol
   *      (bellekte kopya yok).
   *   2. Heap `ByteBuffer`: asset sıkıştırılmış olsa da çalışır.
   *   3. Doğrudan (direct) `ByteBuffer`: heap kısıtlıysa son çare.
   */
  private fun attachSegmenter(context: Context, bitmap: Bitmap) {
    val failures = ArrayList<String>(3)

    val candidates: List<Pair<String, () -> BaseOptions>> = listOf(
      "asset" to { BaseOptions.builder().setModelAssetPath(MODEL_ASSET).build() },
      "buffer" to {
        val bytes = context.assets.open(MODEL_ASSET).use { it.readBytes() }
        BaseOptions.builder().setModelAssetBuffer(ByteBuffer.wrap(bytes)).build()
      },
      "direct" to {
        val bytes = context.assets.open(MODEL_ASSET).use { it.readBytes() }
        val buffer = ByteBuffer.allocateDirect(bytes.size)
        buffer.put(bytes)
        buffer.rewind()
        BaseOptions.builder().setModelAssetBuffer(buffer).build()
      }
    )

    for ((label, makeOptions) in candidates) {
      var created: InteractiveSegmenter? = null
      try {
        val options = InteractiveSegmenterOptions.builder()
          .setBaseOptions(makeOptions())
          .build()
        val instance = InteractiveSegmenter.createFromOptions(context, options)
        created = instance

        val image = BitmapImageBuilder(bitmap).build()
        instance.setImage(image)

        // Önceki görseli serbest bırak, yenisiyle değiştir.
        preparedImage?.let { runCatching { it.close() } }
        preparedImage = image
        segmenter = instance
        loadError = null
        return
      } catch (error: Throwable) {
        runCatching { created?.close() }
        failures.add("$label: ${describe(error)}")
      }
    }

    loadError = failures.joinToString(" | ")
    segmenter = null
  }

  private fun describe(error: Throwable): String {
    val message = error.message?.takeIf { it.isNotBlank() } ?: error.javaClass.simpleName
    return if (error.cause != null && error.cause !== error) {
      "$message (${describe(error.cause!!)})"
    } else {
      message
    }
  }

  /**
   * Düz nokta dizisini vuruşlara böler.
   *
   * Her vuruşun arasına JS tarafından `-1, -1` ayırıcısı konur. Böylece kullanıcı
   * nesnenin iki ayrı yerine dokunduğunda model bu iki noktayı tek bir fırça
   * çizgisi gibi birleştirmez; her dokunuş bağımsız bir pozitif vuruş olur.
   */
  private fun toStrokes(points: List<Double>, mode: Stroke.BrushMode): List<Stroke> {
    val strokes = ArrayList<Stroke>()
    var keypoints = ArrayList<NormalizedKeypoint>()

    fun flush() {
      if (keypoints.isEmpty()) {
        return
      }
      strokes.add(
        Stroke.builder()
          .setBrushMode(mode)
          .setPoints(keypoints)
          .setCompleted(true)
          .build()
      )
      keypoints = ArrayList()
    }

    var index = 0
    while (index + 1 < points.size) {
      val x = points[index]
      val y = points[index + 1]
      if (x < 0 || y < 0) {
        flush()
      } else {
        keypoints.add(
          NormalizedKeypoint.create(
            x.toFloat().coerceIn(0f, 1f),
            y.toFloat().coerceIn(0f, 1f)
          )
        )
      }
      index += 2
    }

    flush()
    return strokes
  }

  /**
   * Modelin güven maskesini ARGB bitmap'e çevirir.
   *
   * Maske float32 ise doğrudan okunur; aksi halde bitmap'e düşülür. Kenarlarda
   * sert bir eşik yerine dar bir geçiş bandı kullanılıyor: bu hem hayalet
   * pikselleri temizler hem de kesim kenarını yumuşak tutar.
   *
   * Model, nesnenin içindeki desenlerde/gölgelerde düşük güven döndürebiliyor.
   * Bu yüzden ham maske `refineMask` ile temizlenir: küçük yarıklar kapatılır ve
   * nesnenin içinde kalan delikler doldurulur.
   */
  private fun confidenceBitmap(mask: MPImage): Bitmap {
    val width = mask.width
    val height = mask.height
    if (width <= 0 || height <= 0) {
      throw SmartCutoutException("Akıllı kesim maskesi boş döndü.", null)
    }

    val confidence = readFloatMask(mask, width, height)
    if (confidence != null) {
      val raw = IntArray(width * height) { smoothAlpha(confidence[it]) }
      val refined = refineMask(raw, width, height)
      val pixels = IntArray(width * height)
      for (index in pixels.indices) {
        val alpha = refined[index]
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

  /**
   * Güven maskesini float dizisi olarak okur.
   *
   * Çıktı her zaman tek kanallı `VEC32F1`'dir; belirli bir format istemek yerine
   * MediaPipe'ın önerdiği doğrudan okuma kullanılır (resmî örnekteki gibi).
   */
  private fun readFloatMask(mask: MPImage, width: Int, height: Int): FloatArray? {
    return try {
      val buffer = ByteBufferExtractor.extract(mask) ?: return null
      buffer.order(ByteOrder.nativeOrder())
      val floats = buffer.asFloatBuffer()
      val expected = width * height
      if (floats.capacity() < expected) {
        return null
      }
      floats.rewind()
      val values = FloatArray(expected)
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

  /**
   * Maskeyi temizler.
   *
   * 1. 3×3 kapatma (dilate → erode): ince yarıkları ve tırtıklı kenarları
   *    kapatır. Kenar pikselleri korunur.
   * 2. Kapalı delik doldurma: dışarıya bağlı olmayan ve seçimin %20'sinden
   *    küçük boşluklar nesnenin parçası sayılır. Böylece modelin düşük güven
   *    verdiği etiket/desen/gölge bölgeleri şeffaf delik olarak kalmaz.
   *
   * Gerçek boşluklar (ör. kupa kulpu) dışarıya bağlı olduğu için korunur;
   * kullanıcı gerekirse "Çıkar" ile işaretleyebilir.
   */
  private fun refineMask(raw: IntArray, width: Int, height: Int): IntArray {
    val total = width * height
    if (total <= 0) {
      return raw
    }

    val mask = BooleanArray(total)
    var opaque = 0
    for (index in 0 until total) {
      if (raw[index] >= OPAQUE_ALPHA) {
        mask[index] = true
        opaque += 1
      }
    }
    if (opaque == 0) {
      return raw
    }

    val dilated = BooleanArray(total)
    for (y in 0 until height) {
      val row = y * width
      for (x in 0 until width) {
        val index = row + x
        if (mask[index]) {
          dilated[index] = true
          continue
        }
        var hit = false
        for (dy in -1..1) {
          val ny = y + dy
          if (ny < 0 || ny >= height) continue
          val nrow = ny * width
          for (dx in -1..1) {
            val nx = x + dx
            if (nx < 0 || nx >= width) continue
            if (mask[nrow + nx]) {
              hit = true
              break
            }
          }
          if (hit) break
        }
        dilated[index] = hit
      }
    }

    val closed = BooleanArray(total)
    for (y in 0 until height) {
      val row = y * width
      for (x in 0 until width) {
        val index = row + x
        if (!dilated[index]) continue
        var all = true
        for (dy in -1..1) {
          if (!all) break
          val ny = y + dy
          if (ny < 0 || ny >= height) continue
          val nrow = ny * width
          for (dx in -1..1) {
            val nx = x + dx
            if (nx < 0 || nx >= width) continue
            if (!dilated[nrow + nx]) {
              all = false
              break
            }
          }
        }
        closed[index] = all
      }
    }

    val visited = BooleanArray(total)
    val queue = IntArray(total)
    val members = IntArray(total)
    val maxHole = max(MIN_HOLE_PIXELS, min(MAX_HOLE_PIXELS, (opaque * 0.2).toInt()))

    for (start in 0 until total) {
      if (closed[start] || visited[start]) continue

      var head = 0
      var tail = 0
      var size = 0
      var touchesBorder = false

      visited[start] = true
      queue[tail++] = start

      while (head < tail) {
        val index = queue[head++]
        members[size++] = index

        val x = index % width
        val y = index / width
        if (x == 0 || y == 0 || x == width - 1 || y == height - 1) {
          touchesBorder = true
        }

        if (x > 0) {
          val next = index - 1
          if (!closed[next] && !visited[next]) {
            visited[next] = true
            queue[tail++] = next
          }
        }
        if (x < width - 1) {
          val next = index + 1
          if (!closed[next] && !visited[next]) {
            visited[next] = true
            queue[tail++] = next
          }
        }
        if (y > 0) {
          val next = index - width
          if (!closed[next] && !visited[next]) {
            visited[next] = true
            queue[tail++] = next
          }
        }
        if (y < height - 1) {
          val next = index + width
          if (!closed[next] && !visited[next]) {
            visited[next] = true
            queue[tail++] = next
          }
        }
      }

      if (!touchesBorder && size <= maxHole) {
        for (i in 0 until size) {
          closed[members[i]] = true
        }
      }
    }

    val out = raw.copyOf()
    for (index in 0 until total) {
      if (closed[index] && out[index] < 255) {
        out[index] = 255
      }
    }
    return out
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
    loadError = null

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

    /**
     * Bu değerin altındaki güven tamamen şeffaf sayılır.
     *
     * Eşik bilinçli olarak düşük: modelin "emin değilim" dediği ama nesneye ait
     * olan pikseller kesimden tamamen düşmesin. Gerçek arka plan gürültüsü zaten
     * ~0 güven alır.
     */
    private const val LOW_CONFIDENCE = 0.08f
    /** Bu değerin üstündeki güven tamamen opak sayılır. */
    private const val HIGH_CONFIDENCE = 0.5f

    /** Bu alfanın altındaki pikseller "boşluk" kabul edilir. */
    private const val OPAQUE_ALPHA = 32

    /** Delik doldurma alt/üst sınırları (piksel). */
    private const val MIN_HOLE_PIXELS = 96
    private const val MAX_HOLE_PIXELS = 60_000
  }
}

class SmartCutoutException(message: String, cause: Throwable?) :
  CodedException(message, cause)
