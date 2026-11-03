import {
  AlphaType,
  BlendMode,
  ClipOp,
  ColorType,
  FilterMode,
  MipmapMode,
  Skia,
  type SkImage,
  type SkPath,
} from '@shopify/react-native-skia';

const ALPHA_THRESHOLD = 8;
const MAX_TRIM_PIXELS = 8_000_000;
const MIN_CUTOUT_SIZE = 8;

/** Şeffaflık tespiti için küçültülen örnek görselin en uzun kenarı. */
const ALPHA_SAMPLE_SIZE = 128;
/** Bu değerin altındaki alfa "şeffaf" sayılır (yuvarlama hatalarını yutar). */
const TRANSPARENT_ALPHA_LIMIT = 250;

/**
 * Lasso path'ine göre görseli keser ve yalnızca seçilen bölgeyi içeren,
 * sıkı sınır kutusuna sahip şeffaf bir görsel döndürür.
 */
export function cutOutWithPath(
  image: SkImage,
  path: SkPath,
  imageSize: { width: number; height: number },
): SkImage | null {
  const bounds = path.getBounds();
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
    return null;
  }

  const width = Math.round(bounds.width);
  const height = Math.round(bounds.height);
  if (width < MIN_CUTOUT_SIZE || height < MIN_CUTOUT_SIZE) {
    return null;
  }

  const surface = Skia.Surface.Make(width, height);
  if (!surface) {
    return null;
  }

  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));
  canvas.save();
  canvas.translate(-bounds.x, -bounds.y);
  canvas.clipPath(path, ClipOp.Intersect, true);

  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  canvas.drawImageRect(
    image,
    Skia.XYWHRect(0, 0, image.width(), image.height()),
    Skia.XYWHRect(0, 0, imageSize.width, imageSize.height),
    paint,
  );
  canvas.restore();
  surface.flush();

  return surface.makeImageSnapshot();
}

/**
 * Görselin tamamen şeffaf kenarlarını kırpar (minX, minY, maxX, maxY).
 * Piksel taraması pahalı olabileceği için büyük görsellerde atlanır.
 */
export function trimTransparentEdges(image: SkImage): SkImage | null {
  const width = image.width();
  const height = image.height();
  if (width <= 0 || height <= 0 || width * height > MAX_TRIM_PIXELS) {
    return null;
  }

  let pixels: Uint8Array | Float32Array | null = null;
  try {
    pixels = image.readPixels(0, 0, {
      width,
      height,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    });
  } catch {
    return null;
  }
  if (!pixels) {
    return null;
  }

  const isFloat = pixels instanceof Float32Array;
  const alphaAt = (pixelIndex: number): number => {
    const alpha = pixels[pixelIndex * 4 + 3];
    return isFloat ? alpha * 255 : alpha;
  };

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      if (alphaAt(rowOffset + x) > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        maxY = y;
      }
    }
  }

  if (maxX < 0 || maxY < 0) {
    return null;
  }

  const alreadyTight =
    minX === 0 && minY === 0 && maxX === width - 1 && maxY === height - 1;
  if (alreadyTight) {
    return null;
  }

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const surface = Skia.Surface.Make(cropWidth, cropHeight);
  if (!surface) {
    return null;
  }

  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  canvas.drawImageRect(
    image,
    Skia.XYWHRect(minX, minY, cropWidth, cropHeight),
    Skia.XYWHRect(0, 0, cropWidth, cropHeight),
    paint,
  );
  surface.flush();

  return surface.makeImageSnapshot();
}

/**
 * Şeffaf kesimin etrafına beyaz sticker konturu ekler. Kontur görselin
 * kendisine gömülür; defterde yeniden hesaplanması gerekmez.
 */
export function addStickerBorder(image: SkImage): SkImage | null {
  const width = image.width();
  const height = image.height();
  if (width <= 0 || height <= 0) {
    return null;
  }

  const outline = Math.min(48, Math.max(4, Math.round(Math.max(width, height) * 0.03)));
  const padding = outline + 2;
  const surface = Skia.Surface.Make(width + padding * 2, height + padding * 2);
  if (!surface) {
    return null;
  }

  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));

  const haloPaint = Skia.Paint();
  haloPaint.setAntiAlias(true);
  haloPaint.setColorFilter(Skia.ColorFilter.MakeBlend(Skia.Color('white'), BlendMode.SrcIn));
  haloPaint.setImageFilter(Skia.ImageFilter.MakeDilate(outline, outline));
  canvas.drawImage(image, padding, padding, haloPaint);

  const imagePaint = Skia.Paint();
  imagePaint.setAntiAlias(true);
  canvas.drawImage(image, padding, padding, imagePaint);

  surface.flush();
  return surface.makeImageSnapshot();
}

/**
 * Kesim -> sıkı kırpma -> beyaz kontur zincirini uygular.
 */
export function finalizeSticker(image: SkImage): SkImage {
  const trimmed = trimTransparentEdges(image);
  const tight = trimmed ?? image;
  const bordered = addStickerBorder(tight);
  return bordered ?? tight;
}

/**
 * Görselde yarı saydam/şeffaf piksel var mı?
 *
 * Paylaşılan bir PNG zaten hazır bir sticker olabilir; bu durumda kırpmaya
 * zorlamamak için şeffaflığı tespit ediyoruz. Maliyeti düşürmek için görsel
 * 128 px'e küçültülüp yalnızca alfa kanalı taranır.
 */
export function imageHasTransparency(image: SkImage): boolean {
  const width = image.width();
  const height = image.height();
  if (width <= 0 || height <= 0) {
    return false;
  }

  const scale = Math.min(1, ALPHA_SAMPLE_SIZE / Math.max(width, height));
  const sampleWidth = Math.max(1, Math.round(width * scale));
  const sampleHeight = Math.max(1, Math.round(height * scale));
  const info = {
    width: sampleWidth,
    height: sampleHeight,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  } as const;

  let source: SkImage = image;
  if (scale < 1) {
    const surface = Skia.Surface.Make(sampleWidth, sampleHeight);
    if (!surface) {
      return false;
    }
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    canvas.drawImageRectOptions(
      image,
      Skia.XYWHRect(0, 0, width, height),
      Skia.XYWHRect(0, 0, sampleWidth, sampleHeight),
      FilterMode.Linear,
      MipmapMode.Linear,
      paint,
    );
    surface.flush();
    source = surface.makeImageSnapshot();
  }

  let pixels: Uint8Array | Float32Array | null = null;
  try {
    pixels = source.readPixels(0, 0, info);
  } catch {
    return false;
  }
  if (!pixels) {
    return false;
  }

  const isFloat = pixels instanceof Float32Array;
  for (let index = 3; index < pixels.length; index += 4) {
    const alpha = isFloat ? pixels[index] * 255 : pixels[index];
    if (alpha < TRANSPARENT_ALPHA_LIMIT) {
      return true;
    }
  }
  return false;
}

/**
 * Kırpma yapmadan, görselin şeffaflığını ve renklerini koruyarak sticker
 * üretir. Yalnızca tamamen boş kenarlar kırpılır; beyaz kontur eklenmez, çünkü
 * paylaşılan görsel zaten kendi konturuna/çerçevesine sahip olabilir.
 */
export function finalizeStickerAsIs(image: SkImage): SkImage {
  const trimmed = trimTransparentEdges(image);
  return trimmed ?? image;
}
