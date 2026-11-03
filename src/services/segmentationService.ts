import { Directory, File, Paths } from 'expo-file-system';
import {
  AlphaType,
  ColorType,
  FilterMode,
  ImageFormat,
  MipmapMode,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';

import { loadSkiaImage } from '@/services/skiaImageLoader';
import {
  isNativeSmartCutoutAvailable,
  segmentSmartCutout,
} from '@/services/smartCutoutService';
import type { Point } from '@/utils/geometry';

/**
 * Akıllı nesne seçimi servisi.
 *
 * Sağlayıcılar görselin tamamıyla aynı boyutta bir **maske** üretir; maskeyi
 * görsele uygulamak `stickerImage.applyMask` işidir. Böylece aynı maske hem
 * canlı önizlemede hem kesimde kullanılabilir.
 */
export type SmartSelectionRequest = {
  imageUri: string;
  /** Editörde zaten yüklü olan görsel; sağlayıcılar tekrar okumaz. */
  image?: SkImage;
  imageSize: { width: number; height: number };
  /**
   * Görsel piksel koordinatında, seçilmek istenen bölgeler.
   *
   * Her dizi ayrı bir vuruştur: bir dokunuş tek nokta, sürükleme ise çok
   * noktalı bir çizgi olur. Model vuruşları karıştırmadan değerlendirir.
   */
  positiveStrokes: Point[][];
  /** Görsel piksel koordinatında, seçimden çıkarılacak vuruşlar. */
  negativeStrokes: Point[][];
};

export type SmartMaskResult = {
  /** Beyaz + alfa taşıyan maske PNG'sinin yerel uri'si. */
  uri: string;
  width: number;
  height: number;
  provider: string;
  /** Birincil sağlayıcı başarısız olduysa nedeni (teşhis için). */
  note?: string;
};

export type SegmentationProvider = {
  id: string;
  isAvailable: () => boolean;
  segment: (request: SmartSelectionRequest) => Promise<SmartMaskResult>;
};

export class SegmentationError extends Error {
  readonly code: 'unavailable' | 'failed';

  constructor(message: string, code: 'unavailable' | 'failed') {
    super(message);
    this.name = 'SegmentationError';
    this.code = code;
  }
}

function getDraftDirectory(): Directory {
  const directory = new Directory(Paths.cache, 'ai-drafts');
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  return directory;
}

async function writeDraftBytes(bytes: Uint8Array): Promise<File> {
  const directory = getDraftDirectory();
  const file = new File(
    directory,
    `mask-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`,
  );
  file.create({ overwrite: true, intermediates: true });
  await file.write(bytes);
  return file;
}

/**
 * Cihaz üzerindeki MediaPipe (MagicTouch) sağlayıcısı.
 *
 * Model uygulamanın içinde geldiği için internet gerekmez; dokunulan noktanın
 * etrafındaki nesneyi gerçek bir sinir ağıyla bulur.
 */
export const nativeSmartProvider: SegmentationProvider = {
  id: 'mediapipe',
  isAvailable: isNativeSmartCutoutAvailable,
  async segment(request) {
    const hasPositive = request.positiveStrokes.some((stroke) => stroke.length > 0);
    if (!hasPositive) {
      throw new SegmentationError('Seçim için nesneye dokun.', 'failed');
    }

    const result = await segmentSmartCutout(
      request.imageSize,
      request.positiveStrokes,
      request.negativeStrokes,
    );

    return {
      uri: result.uri,
      width: result.width,
      height: result.height,
      provider: 'mediapipe',
    };
  },
};

/**
 * Maske bu çözünürlükte hesaplanır. Yedek algoritmanın hız/doğruluk dengesi.
 */
const LOCAL_MASK_MAX_DIMENSION = 1024;
const LOCAL_COLOR_TOLERANCE = 46;
const LOCAL_MIN_REGION_PIXELS = 32;

/** Yedek algoritmada tek vuruştan en fazla kaç tohum noktası kullanılır. */
const POSITIVE_SEED_LIMIT = 4;
const NEGATIVE_SEED_LIMIT = 4;
/**
 * Toplam tohum sayısı: her tohum tam bir flood-fill çalıştırdığı için bu sayı
 * düşük tutulur, aksi halde yedek algoritma saniyeler sürer.
 */
const MAX_POSITIVE_SEEDS = 8;

/** Uzun bir vuruştan eşit aralıklı en fazla `limit` nokta seçer. */
function sampleStroke(stroke: Point[], limit: number): Point[] {
  if (stroke.length <= limit) {
    return stroke;
  }
  const picked: Point[] = [];
  const step = (stroke.length - 1) / (limit - 1);
  for (let index = 0; index < limit; index += 1) {
    picked.push(stroke[Math.round(index * step)]);
  }
  return picked;
}

/** Tüm pozitif vuruşlardan tohum noktaları toplar. */
function collectSeeds(strokes: Point[][]): Point[] {
  const seeds: Point[] = [];
  for (const stroke of strokes) {
    for (const point of sampleStroke(stroke, POSITIVE_SEED_LIMIT)) {
      if (seeds.length >= MAX_POSITIVE_SEEDS) {
        return seeds;
      }
      seeds.push(point);
    }
  }
  return seeds;
}

type RegionMask = {
  mask: Uint8Array;
  count: number;
  borderCoverage: number;
};

/** Dokunulan noktadan başlayıp benzer renkli bağlantılı bölgeyi seçer. */
function buildRegionMask(
  pixels: Uint8Array,
  width: number,
  height: number,
  point: Point,
): RegionMask {
  const startX = Math.max(0, Math.min(width - 1, Math.round(point.x)));
  const startY = Math.max(0, Math.min(height - 1, Math.round(point.y)));
  const start = startY * width + startX;
  const startOffset = start * 4;

  if (pixels[startOffset + 3] < 8) {
    throw new SegmentationError(
      'Bu noktada görünür bir nesne yok. Başka bir noktaya dokun.',
      'failed',
    );
  }

  const targetR = pixels[startOffset];
  const targetG = pixels[startOffset + 1];
  const targetB = pixels[startOffset + 2];
  const toleranceSq = LOCAL_COLOR_TOLERANCE * LOCAL_COLOR_TOLERANCE;
  const total = width * height;
  const selected = new Uint8Array(total);
  const queue = new Int32Array(total);

  let head = 0;
  let tail = 0;
  let count = 0;

  const tryVisit = (index: number) => {
    if (selected[index]) {
      return;
    }
    const offset = index * 4;
    if (pixels[offset + 3] < 8) {
      return;
    }
    const dr = pixels[offset] - targetR;
    const dg = pixels[offset + 1] - targetG;
    const db = pixels[offset + 2] - targetB;
    if (dr * dr + dg * dg + db * db > toleranceSq) {
      return;
    }
    selected[index] = 1;
    queue[tail++] = index;
  };

  tryVisit(start);

  while (head < tail) {
    const index = queue[head++];
    count += 1;

    const x = index % width;
    const y = (index - x) / width;

    if (x > 0) {
      tryVisit(index - 1);
    }
    if (x < width - 1) {
      tryVisit(index + 1);
    }
    if (y > 0) {
      tryVisit(index - width);
    }
    if (y < height - 1) {
      tryVisit(index + width);
    }
  }

  fillSmallHoles(selected, width, height, count);

  let borderTotal = 0;
  let borderSelected = 0;
  const checkBorder = (index: number) => {
    borderTotal += 1;
    if (selected[index]) {
      borderSelected += 1;
    }
  };

  for (let x = 0; x < width; x += 1) {
    checkBorder(x);
    if (height > 1) {
      checkBorder((height - 1) * width + x);
    }
  }
  for (let y = 1; y < height - 1; y += 1) {
    checkBorder(y * width);
    if (width > 1) {
      checkBorder(y * width + width - 1);
    }
  }

  return {
    mask: selected,
    count,
    borderCoverage: borderTotal > 0 ? borderSelected / borderTotal : 0,
  };
}

function fillSmallHoles(
  selected: Uint8Array,
  width: number,
  height: number,
  selectedCount: number,
): void {
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const hole = new Int32Array(total);
  const maxHole = Math.max(24, Math.min(4096, Math.round(selectedCount * 0.02)));

  for (let start = 0; start < total; start += 1) {
    if (selected[start] || visited[start]) {
      continue;
    }

    let head = 0;
    let tail = 0;
    let holeSize = 0;
    let touchesBorder = false;

    visited[start] = 1;
    queue[tail++] = start;

    while (head < tail) {
      const index = queue[head++];
      hole[holeSize++] = index;

      const x = index % width;
      const y = (index - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesBorder = true;
      }

      if (x > 0) {
        const next = index - 1;
        if (!selected[next] && !visited[next]) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
      if (x < width - 1) {
        const next = index + 1;
        if (!selected[next] && !visited[next]) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
      if (y > 0) {
        const next = index - width;
        if (!selected[next] && !visited[next]) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
      if (y < height - 1) {
        const next = index + width;
        if (!selected[next] && !visited[next]) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }

    // Nesnenin içinde kalan küçük renk farkları (göz, desen, gölge gibi)
    // şeffaf delik olarak kalmasın; büyük gerçek boşluklara dokunmuyoruz.
    if (!touchesBorder && holeSize <= maxHole) {
      for (let i = 0; i < holeSize; i += 1) {
        selected[hole[i]] = 1;
      }
    }
  }
}

function makeMaskImage(mask: Uint8Array, width: number, height: number): SkImage {
  const pixels = new Uint8Array(width * height * 4);

  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) {
      const offset = index * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = 255;
    }
  }

  const image = Skia.Image.MakeImage(
    {
      width,
      height,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Premul,
    },
    Skia.Data.fromBytes(pixels),
    width * 4,
  );

  if (!image) {
    throw new SegmentationError('Seçim maskesi oluşturulamadı.', 'failed');
  }

  return image;
}

function makeMaskThumbnail(image: SkImage): {
  image: SkImage;
  scale: number;
  width: number;
  height: number;
} {
  const longest = Math.max(image.width(), image.height());
  const scale = Math.min(1, LOCAL_MASK_MAX_DIMENSION / longest);
  const width = Math.max(1, Math.round(image.width() * scale));
  const height = Math.max(1, Math.round(image.height() * scale));

  // Her durumda CPU yüzeyine çiziyoruz: bazı platformlarda doğrudan kodlanmış
  // görsellerden readPixels alınamıyor, ayrıca piksel formatı garanti ediliyor.
  const surface = Skia.Surface.Make(width, height);
  if (!surface) {
    throw new SegmentationError('Kesim yüzeyi oluşturulamadı.', 'failed');
  }

  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  canvas.drawImageRectOptions(
    image,
    Skia.XYWHRect(0, 0, image.width(), image.height()),
    Skia.XYWHRect(0, 0, width, height),
    FilterMode.Linear,
    MipmapMode.Linear,
    paint,
  );
  surface.flush();

  return {
    image: surface.makeImageSnapshot(),
    scale,
    width,
    height,
  };
}

/**
 * Yedek sağlayıcı: MediaPipe'ın kullanılamadığı durumlarda (iOS, model
 * yüklenemezse) dokunulan noktadan başlayan renk/bağlantı tabanlı seçim.
 * Düz zeminlerde iyi, karmaşık fotoğraflarda sınırlı çalışır.
 */
export const localRegionProvider: SegmentationProvider = {
  id: 'local-region',
  isAvailable: () => true,
  async segment(request) {
    const seeds = collectSeeds(request.positiveStrokes);
    if (seeds.length === 0) {
      throw new SegmentationError('Seçim için nesneye dokun.', 'failed');
    }

    // Yoğun piksel işlemi başlamadan önce "çalışıyor" katmanının çizilmesine
    // fırsat ver.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const image = request.image ?? (await loadSkiaImage(request.imageUri));
    const thumbnail = makeMaskThumbnail(image);
    let pixels: Uint8Array | Float32Array | null = null;

    try {
      pixels = thumbnail.image.readPixels(0, 0, {
        width: thumbnail.width,
        height: thumbnail.height,
        colorType: ColorType.RGBA_8888,
        alphaType: AlphaType.Unpremul,
      });
    } catch (cause) {
      console.warn('[StickerCam] segment pikselleri okunamadı:', cause);
    }

    if (!(pixels instanceof Uint8Array)) {
      throw new SegmentationError('Görsel pikselleri okunamadı.', 'failed');
    }

    const toThumbPoint = (point: Point) => ({
      x: point.x * thumbnail.scale,
      y: point.y * thumbnail.scale,
    });

    const total = thumbnail.width * thumbnail.height;
    const union = new Uint8Array(total);
    let count = 0;
    let borderCoverage = 0;
    let usedSeeds = 0;

    // Her pozitif vuruş kendi bölgesini üretir ve hepsi birleştirilir.
    // (Eskiden yalnızca ilk dokunuş kullanılıyordu, bu yüzden "Ekle" hiçbir
    // şey yapmıyor gibi görünüyordu.)
    for (const seed of seeds) {
      try {
        const part = buildRegionMask(
          pixels,
          thumbnail.width,
          thumbnail.height,
          toThumbPoint(seed),
        );
        usedSeeds += 1;
        borderCoverage = Math.max(borderCoverage, part.borderCoverage);
        for (let index = 0; index < part.mask.length; index += 1) {
          if (part.mask[index] && !union[index]) {
            union[index] = 1;
            count += 1;
          }
        }
      } catch {
        // Boşluğa denk gelen dokunuşu yok say.
      }
    }

    if (usedSeeds === 0) {
      throw new SegmentationError(
        'Bu noktada seçilecek bir nesne bulunamadı. Başka bir yere dokun.',
        'failed',
      );
    }

    // Negatif vuruşlar aynı mantıkla seçimden çıkarılır.
    for (const stroke of request.negativeStrokes) {
      for (const point of sampleStroke(stroke, NEGATIVE_SEED_LIMIT)) {
        try {
          const excluded = buildRegionMask(
            pixels,
            thumbnail.width,
            thumbnail.height,
            toThumbPoint(point),
          );
          for (let index = 0; index < excluded.mask.length; index += 1) {
            if (excluded.mask[index]) {
              union[index] = 0;
            }
          }
        } catch {
          // Negatif nokta boşluğa denk geldiyse yok say.
        }
      }
    }

    const region = { mask: union, count, borderCoverage };

    if (region.count < LOCAL_MIN_REGION_PIXELS) {
      throw new SegmentationError(
        'Seçim çok küçük görünüyor. Nesnenin içine dokun.',
        'failed',
      );
    }

    if (
      region.borderCoverage > 0.55 &&
      region.count / (thumbnail.width * thumbnail.height) > 0.18
    ) {
      throw new SegmentationError(
        'Arka plan seçilmiş görünüyor. Kesmek istediğin nesnenin üzerine dokun.',
        'failed',
      );
    }

    const mask = makeMaskImage(region.mask, thumbnail.width, thumbnail.height);
    const width = image.width();
    const height = image.height();

    // Maskeyi tam çözünürlüğe büyütüyoruz; kenarlar çift doğrusal örnekleme
    // sayesinde merdiven görünmüyor.
    const surface = Skia.Surface.Make(width, height);
    if (!surface) {
      throw new SegmentationError('Kesim maskesi oluşturulamadı.', 'failed');
    }
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    const maskPaint = Skia.Paint();
    maskPaint.setAntiAlias(true);
    canvas.drawImageRectOptions(
      mask,
      Skia.XYWHRect(0, 0, thumbnail.width, thumbnail.height),
      Skia.XYWHRect(0, 0, width, height),
      FilterMode.Linear,
      MipmapMode.Linear,
      maskPaint,
    );
    surface.flush();

    const fullMask = surface.makeImageSnapshot();
    const file = await writeDraftBytes(
      new Uint8Array(fullMask.encodeToBytes(ImageFormat.PNG, 100)),
    );

    return {
      uri: file.uri,
      width,
      height,
      provider: 'local-region',
    };
  },
};

/** Kullanılabilir sağlayıcıları sırayla dener. */
export async function segmentMask(
  request: SmartSelectionRequest,
): Promise<SmartMaskResult> {
  const providers = [nativeSmartProvider, localRegionProvider].filter((provider) =>
    provider.isAvailable(),
  );

  if (providers.length === 0) {
    throw new SegmentationError(
      'Akıllı kesim bu cihazda kullanılamıyor. Serbest çizim modunu deneyebilirsin.',
      'unavailable',
    );
  }

  let lastError: unknown = null;
  let note: string | undefined;
  for (const provider of providers) {
    try {
      const result = await provider.segment(request);
      return note ? { ...result, note } : result;
    } catch (error) {
      lastError = error;
      note = error instanceof Error ? error.message : String(error);
      console.warn(`[StickerCam] ${provider.id} segmentasyonu başarısız:`, error);
    }
  }

  if (lastError instanceof SegmentationError) {
    throw lastError;
  }
  throw new SegmentationError(
    'Akıllı kesim başarısız oldu. Serbest çizim modunu deneyebilirsin.',
    'failed',
  );
}

export function isSmartSelectionAvailable(): boolean {
  return nativeSmartProvider.isAvailable() || localRegionProvider.isAvailable();
}
