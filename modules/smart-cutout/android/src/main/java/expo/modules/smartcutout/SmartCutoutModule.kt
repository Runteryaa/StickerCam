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
import com.google.mediapipe.tasks.vision.interactivesegmenterlegacy.InteractiveSegmenterLegacy
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
  /**
   * Hangi akıllı kesim motorunun kullanıldığını belirtir.
   *
   * MediaPipe iki API sunuyor: durumlu (stateful) yeni `InteractiveSegmenter`
   * ve tek seferlik `InteractiveSegmenterLegacy`. Yeni API bazı cihaz/sürüm
   * birleşimlerinde grafiği çalıştıramıyor; o durumda sessizce yedeğe geçiyoruz
   * ki kullanıcı hiçbir zaman "çalışmıyor" durumunda kalmasın.
   */
  private enum class Engine(val label: String) {
    NONE("yok"),
    STROKE("magictouch"),
    LEGACY("magictouch-legacy")
  }

  private val lock = Any()

  private var engine = Engine.NONE
  private var strokeSegmenter: InteractiveSegmenter? = null
  private var legacySegmenter: InteractiveSegmenterLegacy? = null
  private var preparedBitmap: Bitmap? = null
  private var preparedImage: MPImage? = null
  private var preparedWidth = 0
  private var preparedHeight = 0
  /** Hiçbir motor yüklenemediyse nedeni; kullanıcıya gösterilir. */
  private var loadError: String? = null
  /** Model yüklendiği halde deneme segmentasyonu düştüyse nedeni. */
  private var selfTestError: String? = null

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

        // Modeli şimdi yüklemeye çalışıyoruz. Yüklenemezse görsel bellekte
        // kalır ve ilk dokunuşta bir kez daha denenir.
        loadEngine(context, bitmap)

        mapOf(
          "width" to preparedWidth,
          "height" to preparedHeight,
          "modelLoaded" to (engine != Engine.NONE),
          "engine" to engine.label,
          "error" to loadError,
          "selfTest" to selfTestError
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
        if (engine == Engine.NONE) {
          loadEngine(context(), bitmap)
        }

        // Her dokunuş/sürükleme ayrı bir vuruş olarak gönderilir; aksi halde
        // model iki uzak noktayı tek bir fırça çizgisi sanıp yanlış bölge seçer.
        val positiveStrokes = toStrokes(positivePoints, Stroke.BrushMode.POSITIVE)
        val negativeStrokes = toStrokes(negativePoints, Stroke.BrushMode.NEGATIVE)

        if (positiveStrokes.isEmpty()) {
          throw SmartCutoutException("Seçim için en az bir nokta gerekli.", null)
        }

        val negativeTaps = toTaps(negativePoints)
        val context = context()

        val maskImage = when (engine) {
          Engine.STROKE -> {
            val segmenter = strokeSegmenter ?: throw SmartCutoutException(
              "Akıllı kesim oturumu hazır değil.",
              null
            )
            segment(segmenter, positiveStrokes + negativeStrokes)
          }

          Engine.LEGACY -> {
            val segmenter = legacySegmenter ?: throw SmartCutoutException(
              "Akıllı kesim oturumu hazır değil.",
              null
            )
            val image = preparedImage ?: BitmapImageBuilder(bitmap).build()
            val keypoints = sampleKeypoints(positiveStrokes.flatMap { it.points() })
            val result = try {
              segmenter.segment(
                image,
                InteractiveSegmenterLegacy.RegionOfInterest.create(keypoints)
              )
            } catch (error: Throwable) {
              throw SmartCutoutException(
                "Akıllı kesim çalıştırılamadı: ${describe(error)}",
                error
              )
            }
            val confidenceMasks = result.confidenceMasks()
            val mask = if (confidenceMasks.isPresent) {
              confidenceMasks.get().firstOrNull()
            } else {
              null
            }
            mask ?: throw SmartCutoutException("Akıllı kesim maskesi boş döndü.", null)
          }

          Engine.NONE -> throw SmartCutoutException(
            "Akıllı kesim modeli yüklenemedi: ${loadError ?: selfTestError ?: "bilinmeyen hata"}",
            null
          )
        }

        try {
          writeMask(context, maskImage, negativeTaps)
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
   * Segmentasyonu çalıştırır.
   *
   * Bazı MediaPipe sürümleri tek noktalı (dokunma) vuruşlarda grafiği
   * çalıştıramıyor. Böyle bir durumda dokunuşu çok küçük iki noktalı bir
   * vuruşa çevirip bir kez daha deniyoruz; tek nokta bilgisi (dokunulan yer)
   * aynı kaldığı için sonuç değişmiyor.
   */
  private fun segment(segmenter: InteractiveSegmenter, strokes: List<Stroke>): MPImage {
    try {
      return segmenter.segment(strokes)
    } catch (first: Throwable) {
      val canPad = strokes.any { it.points().size < 2 }
      if (canPad) {
        try {
          return segmenter.segment(strokes.map { padStroke(it) })
        } catch (second: Throwable) {
          throw SmartCutoutException(
            "Akıllı kesim çalıştırılamadı: ${describe(first)}",
            second
          )
        }
      }
      throw SmartCutoutException(
        "Akıllı kesim çalıştırılamadı: ${describe(first)}",
        first
      )
    }
  }

  /** Tek noktalı vuruşu, aynı yeri hedefleyen iki noktalı vuruşa çevirir. */
  private fun padStroke(stroke: Stroke): Stroke {
    val points = stroke.points()
    if (points.size >= 2) {
      return stroke
    }
    val only = points.firstOrNull() ?: return stroke
    val x = only.x()
    val y = only.y()
    val nudged = NormalizedKeypoint.create(
      (x + 0.004f).coerceIn(0f, 1f),
      (y + 0.004f).coerceIn(0f, 1f)
    )
    return Stroke.builder()
      .setBrushMode(stroke.brushMode())
      .setPoints(listOf(only, nudged))
      .setCompleted(true)
      .build()
  }

  /** Hazırlık aşamasındaki deneme segmentasyonu için vuruş. */
  private fun syntheticStroke(): Stroke = Stroke.builder()
    .setBrushMode(Stroke.BrushMode.POSITIVE)
    .setPoints(
      listOf(
        NormalizedKeypoint.create(0.5f, 0.5f),
        NormalizedKeypoint.create(0.504f, 0.504f)
      )
    )
    .setCompleted(true)
    .build()

  /**
   * Modeli yüklemeye çalışır; başarılı olursa `engine` ayarlanır.
   *
   * Sıra:
   *   1. Durumlu (yeni) `InteractiveSegmenter` API'si denenir ve bir deneme
   *      segmentasyonu çalıştırılır. Bu API bazı cihaz/sürüm birleşimlerinde
   *      grafiği çalıştıramıyor; o zaman sessizce aşağıdaki yedeğe geçilir.
   *   2. `InteractiveSegmenterLegacy` (tek seferlik API) denenir. Aynı modeli
   *      kullanır, yalnızca pozitif noktalarla çalışır.
   *   3. İkisi de olmazsa `loadError`/`selfTestError` gerçek nedenleri toplar.
   */
  private fun loadEngine(context: Context, bitmap: Bitmap) {
    releaseEngines()
    loadError = null
    selfTestError = null

    val failures = ArrayList<String>(4)

    // --- 1) Durumlu / vuruş tabanlı API -------------------------------------
    val stroke = createStrokeSegmenter(context, failures)

    if (stroke != null) {
      var image: MPImage? = null
      try {
        val mpImage = BitmapImageBuilder(bitmap).build()
        image = mpImage
        stroke.setImage(mpImage)

        // Deneme segmentasyonu: model gerçekten çalışıyor mu?
        val probe = stroke.segment(listOf(syntheticStroke()))
          ?: throw IllegalStateException("segment() boş sonuç döndü")
        runCatching { probe.close() }

        preparedImage?.let { runCatching { it.close() } }
        preparedImage = mpImage
        strokeSegmenter = stroke
        engine = Engine.STROKE
        return
      } catch (error: Throwable) {
        runCatching { image?.close() }
        runCatching { stroke.close() }
        selfTestError = "vuruş: ${describe(error)}"
        failures.add("vuruş: ${describe(error)}")
      }
    }

    // --- 2) Tek seferlik (legacy) API ---------------------------------------
    val legacy = createLegacySegmenter(context, failures)

    if (legacy != null) {
      val image = BitmapImageBuilder(bitmap).build()
      try {
        // Aynı deneme segmentasyonu: model gerçekten maske üretiyor mu?
        val result = legacy.segment(
          image,
          InteractiveSegmenterLegacy.RegionOfInterest.create(
            listOf(NormalizedKeypoint.create(0.5f, 0.5f))
          )
        )
        val masks = result.confidenceMasks()
        val probe = if (masks.isPresent) masks.get().firstOrNull() else null
        if (probe == null) {
          throw IllegalStateException("segment() boş sonuç döndü")
        }
        runCatching { probe.close() }

        preparedImage?.let { runCatching { it.close() } }
        preparedImage = image
        legacySegmenter = legacy
        engine = Engine.LEGACY
        return
      } catch (error: Throwable) {
        runCatching { image.close() }
        runCatching { legacy.close() }
        selfTestError = listOfNotNull(
          selfTestError,
          "legacy: ${describe(error)}"
        ).joinToString(" | ")
        failures.add("legacy: ${describe(error)}")
      }
    }

    engine = Engine.NONE
    loadError = failures.joinToString(" | ")
  }

  /**
   * Model dosyasını açmanın üç yolu.
   *
   * Her biri farklı cihaz/APK yapılandırmasında çalışabildiği için sırayla
   * denenir:
   *   1. `setModelAssetPath`: asset sıkıştırılmamışsa en verimli yol.
   *   2. Heap `ByteBuffer`: asset sıkıştırılmış olsa da çalışır.
   *   3. Doğrudan (direct) `ByteBuffer`: heap kısıtlıysa son çare.
   */
  private fun baseOptionStrategies(context: Context): List<Pair<String, () -> BaseOptions>> =
    listOf(
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

  /** Yeni (durumlu) API için model oluşturur; olmazsa hata metinlerini toplar. */
  private fun createStrokeSegmenter(
    context: Context,
    failures: MutableList<String>
  ): InteractiveSegmenter? {
    for ((label, makeOptions) in baseOptionStrategies(context)) {
      try {
        return InteractiveSegmenter.createFromOptions(
          context,
          InteractiveSegmenterOptions.builder().setBaseOptions(makeOptions()).build()
        )
      } catch (error: Throwable) {
        failures.add("vuruş/$label: ${describe(error)}")
      }
    }
    return null
  }

  /** Legacy API için model oluşturur; olmazsa hata metinlerini toplar. */
  private fun createLegacySegmenter(
    context: Context,
    failures: MutableList<String>
  ): InteractiveSegmenterLegacy? {
    for ((label, makeOptions) in baseOptionStrategies(context)) {
      try {
        return InteractiveSegmenterLegacy.createFromOptions(
          context,
          InteractiveSegmenterLegacy.InteractiveSegmenterLegacyOptions.builder()
            .setBaseOptions(makeOptions())
            .setOutputConfidenceMasks(true)
            .build()
        )
      } catch (error: Throwable) {
        failures.add("legacy/$label: ${describe(error)}")
      }
    }
    return null
  }

  /** Legacy API'ye gönderilecek nokta sayısını sınırlar. */
  private fun sampleKeypoints(
    points: List<NormalizedKeypoint>,
    limit: Int = 8
  ): List<NormalizedKeypoint> {
    if (points.size <= limit) {
      return points
    }
    val step = (points.size - 1).toDouble() / (limit - 1)
    return (0 until limit).map { points[(it * step).roundToInt()] }
  }

  /** Negatif dokunuşları normalize koordinat çiftlerine çevirir. */
  private fun toTaps(points: List<Double>): List<Pair<Float, Float>> {
    val taps = ArrayList<Pair<Float, Float>>()
    var index = 0
    while (index + 1 < points.size) {
      val x = points[index]
      val y = points[index + 1]
      if (x >= 0 && y >= 0) {
        taps.add(
          x.toFloat().coerceIn(0f, 1f) to y.toFloat().coerceIn(0f, 1f)
        )
      }
      index += 2
    }
    return taps
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
  private fun confidenceBitmap(
    mask: MPImage,
    negativeTaps: List<Pair<Float, Float>> = emptyList()
  ): Bitmap {
    val width = mask.width
    val height = mask.height
    if (width <= 0 || height <= 0) {
      throw SmartCutoutException("Akıllı kesim maskesi boş döndü.", null)
    }

    val confidence = readFloatMask(mask, width, height)
    if (confidence != null) {
      val raw = IntArray(width * height) { smoothAlpha(confidence[it]) }
      // Legacy motor negatif noktaları modele veremiyor; çıkarma burada yapılır.
      if (negativeTaps.isNotEmpty() && engine == Engine.LEGACY) {
        subtractNegativeRegions(preparedBitmap, raw, width, height, negativeTaps)
      }
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
   * Negatif dokunuşları maskeden çıkarır.
   *
   * Yalnızca legacy motorda gerekir: yeni API negatif vuruşları modele ilettiği
   * için orada bu iş yapılmaz. Dokunulan noktadan başlayan renk benzerliğine
   * dayalı bağlı bölge silinir; böylece "Çıkar" düğmesi iki motorda da çalışır.
   */
  private fun subtractNegativeRegions(
    source: Bitmap?,
    alpha: IntArray,
    width: Int,
    height: Int,
    taps: List<Pair<Float, Float>>
  ) {
    if (source == null || source.isRecycled) {
      return
    }
    if (source.width != width || source.height != height) {
      return
    }

    val pixels = IntArray(width * height)
    source.getPixels(pixels, 0, width, 0, 0, width, height)

    val visited = BooleanArray(width * height)
    val queue = IntArray(width * height)
    val toleranceSq = 42 * 42

    for ((nx, ny) in taps.take(4)) {
      val seedX = (nx * width).roundToInt().coerceIn(0, width - 1)
      val seedY = (ny * height).roundToInt().coerceIn(0, height - 1)
      val seed = seedY * width + seedX
      if (alpha[seed] <= 0 || visited[seed]) {
        continue
      }

      val target = pixels[seed]
      val tr = Color.red(target)
      val tg = Color.green(target)
      val tb = Color.blue(target)

      var head = 0
      var tail = 0
      visited[seed] = true
      queue[tail++] = seed

      while (head < tail) {
        val index = queue[head++]
        alpha[index] = 0

        val x = index % width
        val y = index / width

        fun push(nextX: Int, nextY: Int) {
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
            return
          }
          val next = nextY * width + nextX
          if (visited[next] || alpha[next] <= 0) {
            return
          }
          val pixel = pixels[next]
          val dr = Color.red(pixel) - tr
          val dg = Color.green(pixel) - tg
          val db = Color.blue(pixel) - tb
          if (dr * dr + dg * dg + db * db > toleranceSq) {
            return
          }
          visited[next] = true
          queue[tail++] = next
        }

        push(x - 1, y)
        push(x + 1, y)
        push(x, y - 1)
        push(x, y + 1)
      }
    }
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

  private fun writeMask(
    context: Context,
    mask: MPImage,
    negativeTaps: List<Pair<Float, Float>>
  ): Map<String, Any?> {
    val bitmap = confidenceBitmap(mask, negativeTaps)
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
    releaseEngines()
    loadError = null
    selfTestError = null

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

  /** Yalnızca motorları kapatır; hazırlanmış görseli korur. */
  private fun releaseEngines() {
    strokeSegmenter?.let { runCatching { it.close() } }
    strokeSegmenter = null

    legacySegmenter?.let { runCatching { it.close() } }
    legacySegmenter = null

    engine = Engine.NONE
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
