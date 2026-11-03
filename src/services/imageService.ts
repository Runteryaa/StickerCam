import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { loadSkiaImage } from '@/services/skiaImageLoader';
import { imageHasTransparency } from '@/utils/stickerImage';

/**
 * Editörde işlenecek görsellerin en uzun kenarı. Skia tarafında bellek ve
 * kesim kalitesi arasında iyi bir denge sağlar.
 */
const MAX_EDIT_DIMENSION = 2048;

/** Alfa kanalı taşıyabilen kaynak formatları. */
const ALPHA_MIME_TYPES = new Set([
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
]);

const ALPHA_EXTENSION_PATTERN = /\.(png|webp|gif|bmp|apng)(?:$|[?#])/i;

export type PreparedPhoto = {
  uri: string;
  width: number;
  height: number;
  /** Görselin en az bir şeffaf/yarı saydam pikseli var mı? */
  hasAlpha: boolean;
};

export type PreparePhotoOptions = {
  mimeType?: string | null;
  fileName?: string | null;
};

function sourceCanCarryAlpha(uri: string, options: PreparePhotoOptions): boolean {
  const mimeType = options.mimeType?.toLowerCase().trim();
  if (mimeType && ALPHA_MIME_TYPES.has(mimeType)) {
    return true;
  }
  return ALPHA_EXTENSION_PATTERN.test(options.fileName ?? uri);
}

/**
 * Kamera/galeri/paylaşım görselini editöre hazırlar.
 *
 * - EXIF orientation'ı "pişirir" (Skia encoded görsellerde EXIF yönünü uygulamaz).
 * - Çok büyük fotoğrafları decode sırasında makul bir çözünürlüğe indirir.
 * - Şeffaflık taşıyabilecek kaynaklar (PNG/WebP/GIF/BMP) **PNG olarak** yeniden
 *   kodlanır; böylece alfa kanalı JPEG'e dönüşürken kaybolmaz.
 * - Sonuç cache dizinine yazılır.
 */
export async function preparePhoto(
  uri: string,
  options: PreparePhotoOptions = {},
): Promise<PreparedPhoto> {
  const keepAlpha = sourceCanCarryAlpha(uri, options);

  const context = ImageManipulator.manipulate(uri, {
    maxWidth: MAX_EDIT_DIMENSION,
    maxHeight: MAX_EDIT_DIMENSION,
  });

  const image = await context.renderAsync();
  const saved = await image.saveAsync(
    keepAlpha
      ? { format: SaveFormat.PNG }
      : { format: SaveFormat.JPEG, compress: 0.94 },
  );

  let hasAlpha = false;
  if (keepAlpha) {
    try {
      hasAlpha = imageHasTransparency(await loadSkiaImage(saved.uri));
    } catch {
      // Tespit başarısız olursa görsel yine de kullanılabilir.
      hasAlpha = false;
    }
  }

  return {
    uri: saved.uri,
    width: saved.width,
    height: saved.height,
    hasAlpha,
  };
}
