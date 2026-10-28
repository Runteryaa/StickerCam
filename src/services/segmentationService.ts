import { Directory, File, Paths } from 'expo-file-system';
import {
  AlphaType,
  BlendMode,
  ClipOp,
  ColorType,
  FilterMode,
  ImageFormat,
  MipmapMode,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';

import { loadSkiaImage } from '@/services/skiaImageLoader';
import type { Point } from '@/utils/geometry';

/**
 * Nesne seçimi (segmentasyon) servis katmanı.
 *
 * Varsayılan olarak cihaz üzerinde çalışan renk/bağlantı tabanlı bir sağlayıcı
 * kullanılır; gerçek bir ML modeli veya uzak API bağlanmak istendiğinde aynı
 * sözleşmeyle yeni bir sağlayıcı eklenir.
 */
export type SegmentationRequest = {
  imageUri: string;
  /** Editörde zaten yüklü olan görsel; yerel sağlayıcılar tekrar okumaz. */
  image?: SkImage;
  /** Dokunulan nokta, görselin piksel koordinatında. */
  point: Point;
  imageSize: { width: number; height: number };
};

export type SegmentationResult = {
  /** Şeffaf PNG dosyasının yerel uri'si. */
  uri: string;
  width: number;
  height: number;
  provider: string;
};

export type SegmentationProvider = {
  id: string;
  label: string;
  isAvailable: () => boolean;
  segment: (request: SegmentationRequest) => Promise<SegmentationResult>;
};

export class SegmentationError extends Error {
  readonly code: 'unavailable' | 'failed';

  constructor(message: string, code: 'unavailable' | 'failed') {
    super(message);
    this.name = 'SegmentationError';
    this.code = code;
  }
}

const REQUEST_TIMEOUT_MS = 20_000;

function getDraftDirectory(): Directory {
  const directory = new Directory(Paths.cache, 'ai-drafts');
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  return directory;
}

async function writeDraftBytes(bytes: Uint8Array): Promise<File> {
  const directory = getDraftDirectory();
  const file = new File(directory, `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`);
  file.create({ overwrite: true, intermediates: true });
  await file.write(bytes);
  return file;
}

/**
 * Uzak segmentasyon API'si. `EXPO_PUBLIC_SEGMENTATION_URL` tanımlıysa etkindir.
 * Sözleşme: multipart/form-data (image, x, y, width, height) -> image/png
 */
export const httpSegmentationProvider: SegmentationProvider = {
  id: 'http',
  label: 'Uzak AI servisi',
  isAvailable: () => Boolean(process.env.EXPO_PUBLIC_SEGMENTATION_URL),
  async segment(request) {
    const endpoint = process.env.EXPO_PUBLIC_SEGMENTATION_URL;
    if (!endpoint) {
      throw new SegmentationError('Segmentasyon servisi tanımlı değil.', 'unavailable');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const form = new FormData();
      form.append('image', {
        uri: request.imageUri,
        name: 'photo.jpg',
        type: 'image/jpeg',
      } as unknown as Blob);
      form.append('x', String(Math.round(request.point.x)));
      form.append('y', String(Math.round(request.point.y)));
      form.append('width', String(request.imageSize.width));
      form.append('height', String(request.imageSize.height));

      const response = await fetch(endpoint, {
        method: 'POST',
        body: form,
        headers: { Accept: 'image/png' },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new SegmentationError(`Segmentasyon servisi ${response.status} döndü.`, 'failed');
      }

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength === 0) {
        throw new SegmentationError('Segmentasyon servisi boş yanıt döndü.', 'failed');
      }

      const file = await writeDraftBytes(new Uint8Array(buffer));
      const image = await loadSkiaImage(file.uri);

      return {
        uri: file.uri,
        width: image.width(),
        height: image.height(),
        provider: 'http',
      };
    } catch (error) {
      if (error instanceof SegmentationError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new SegmentationError('Segmentasyon isteği zaman aşımına uğradı.', 'failed');
      }
      throw new SegmentationError('Segmentasyon isteği başarısız oldu.', 'failed');
    } finally {
      clearTimeout(timeout);
    }
  },
};

/**
 * Geliştirme sırasında akışı denemek için yerel "sahte" sağlayıcı.
 * Gerçek bir model değildir; dokunulan noktanın etrafında elips şeklinde bir
 * kesim üretir. `EXPO_PUBLIC_SEGMENTATION_DEMO=1` ile etkinleşir.
 */
export const demoLocalSegmentationProvider: SegmentationProvider = {
  id: 'demo-local',
  label: 'Yerel demo kesim',
  isAvailable: () => process.env.EXPO_PUBLIC_SEGMENTATION_DEMO === '1',
  async segment(request) {
    const image = request.image ?? (await loadSkiaImage(request.imageUri));
    const radius = Math.max(24, Math.min(image.width(), image.height()) * 0.24);
    const size = Math.round(radius * 2);
    const surface = Skia.Surface.Make(size, size);
    if (!surface) {
      throw new SegmentationError('Kesim yüzeyi oluşturulamadı.', 'failed');
    }

    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));

    const circle = Skia.Path.Circle(size / 2, size / 2, radius);

    canvas.save();
    canvas.clipPath(circle, ClipOp.Intersect, true);
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    canvas.drawImageRect(
      image,
      Skia.XYWHRect(0, 0, image.width(), image.height()),
      Skia.XYWHRect(
        size / 2 - request.point.x,
        size / 2 - request.point.y,
        image.width(),
        image.height(),
      ),
      paint,
    );
    canvas.restore();
    surface.flush();

    const cutout = surface.makeImageSnapshot();
    const file = await writeDraftBytes(
      new Uint8Array(cutout.encodeToBytes(ImageFormat.PNG, 100)),
    );

    return {
      uri: file.uri,
      width: cutout.width(),
      height: cutout.height(),
      provider: 'demo-local',
    };
  },
};

/**
 * Cihaz üzerinde çalışan deneysel otomatik kesim.
 *
 * Ağır bir ML modeli yerine, dokunulan noktadan başlayıp benzer renkli
 * bağlantılı bölgeyi seçer. Düz/az desenli zeminlerde pratik sonuç verir;
 * karmaşık fotoğraflarda serbest çizim daha güvenilirdir.
 */
const LOCAL_MASK_MAX_DIMENSION = 640;
const LOCAL_COLOR_TOLERANCE = 52;
const LOCAL_MIN_REGION_PIXELS = 32;

type RegionMask = {
  mask: Uint8Array;
  count: number;
  borderCoverage: number;
};

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

  // Seçim arka plana taşarsa kullanıcıyı uyar. Arka plan seçildiğinde
  // görselin kenar piksellerinin büyük kısmı da seçilmiş olur.
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
    MipmapMode.None,
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

export const localRegionSegmentationProvider: SegmentationProvider = {
  id: 'local-region',
  label: 'Yerel otomatik kesim',
  isAvailable: () => true,
  async segment(request) {
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

    const region = buildRegionMask(pixels, thumbnail.width, thumbnail.height, {
      x: request.point.x * thumbnail.scale,
      y: request.point.y * thumbnail.scale,
    });

    if (region.count < LOCAL_MIN_REGION_PIXELS) {
      throw new SegmentationError(
        'Seçim çok küçük görünüyor. Nesnenin içine dokun.',
        'failed',
      );
    }

    if (region.borderCoverage > 0.55 && region.count / (thumbnail.width * thumbnail.height) > 0.18) {
      throw new SegmentationError(
        'Arka plan seçilmiş görünüyor. Kesmek istediğin nesnenin üzerine dokun.',
        'failed',
      );
    }

    const mask = makeMaskImage(region.mask, thumbnail.width, thumbnail.height);
    const width = image.width();
    const height = image.height();
    const surface = Skia.Surface.Make(width, height);

    if (!surface) {
      throw new SegmentationError('Kesim yüzeyi oluşturulamadı.', 'failed');
    }

    const canvas = surface.getCanvas();
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    canvas.drawImageRect(
      image,
      Skia.XYWHRect(0, 0, width, height),
      Skia.XYWHRect(0, 0, width, height),
      paint,
    );

    const maskPaint = Skia.Paint();
    maskPaint.setAntiAlias(true);
    maskPaint.setBlendMode(BlendMode.DstIn);
    canvas.drawImageRectOptions(
      mask,
      Skia.XYWHRect(0, 0, thumbnail.width, thumbnail.height),
      Skia.XYWHRect(0, 0, width, height),
      FilterMode.Linear,
      MipmapMode.None,
      maskPaint,
    );
    surface.flush();

    const cutout = surface.makeImageSnapshot();
    const file = await writeDraftBytes(
      new Uint8Array(cutout.encodeToBytes(ImageFormat.PNG, 100)),
    );

    return {
      uri: file.uri,
      width: cutout.width(),
      height: cutout.height(),
      provider: 'local-region',
    };
  },
};

/**
 * Kullanılabilir sağlayıcıları sırayla dener.
 */
export async function segmentImage(
  request: SegmentationRequest,
): Promise<SegmentationResult> {
  const providers = [
    httpSegmentationProvider,
    localRegionSegmentationProvider,
    demoLocalSegmentationProvider,
  ].filter((provider) => provider.isAvailable());

  if (providers.length === 0) {
    throw new SegmentationError(
      'Akıllı kesim servisi bağlı değil. Serbest çizim moduna geçip nesnenin etrafını çizebilirsin.',
      'unavailable',
    );
  }

  let lastError: unknown = null;
  for (const provider of providers) {
    try {
      return await provider.segment(request);
    } catch (error) {
      lastError = error;
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
  return (
    httpSegmentationProvider.isAvailable() ||
    localRegionSegmentationProvider.isAvailable() ||
    demoLocalSegmentationProvider.isAvailable()
  );
}
