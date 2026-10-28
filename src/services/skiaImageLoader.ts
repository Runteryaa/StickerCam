import { File } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { Skia, type SkImage } from '@shopify/react-native-skia';

import { withTimeout } from '@/utils/withTimeout';

/**
 * Bazı yönlendirme katmanları dosya URI'sinin şemasını URL-encode edebiliyor.
 * `file%3A%2F%2F...` gibi bir değeri dosya sistemine vermeden önce çözüyoruz.
 */
export function normalizeImageUri(value: string): string {
  let uri = value.trim();

  if (/^file%3a/i.test(uri)) {
    try {
      uri = decodeURIComponent(uri);
    } catch {
      // Çözülemezse ham değerle devam et.
    }
  }

  if (uri.startsWith('/')) {
    return `file://${uri}`;
  }

  return uri;
}

/**
 * Bir görseli Skia'ya güvenilir şekilde yükler.
 *
 * Skia'nın `Data.fromURI` yolu bazı dosya URI'lerinde sessizce takılabiliyor.
 * Önce yeni File API'siyle, olmazsa legacy base64 API'siyle okuyoruz.
 */
export async function loadSkiaImage(uri: string): Promise<SkImage> {
  const sourceUri = normalizeImageUri(uri);

  try {
    const file = new File(sourceUri);
    if (file.exists) {
      const bytes = await withTimeout(
        file.bytes(),
        15_000,
        'Fotoğraf yüklenmesi zaman aşımına uğradı.',
      );
      const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
      if (image) {
        return image;
      }
    }
  } catch (cause) {
    console.warn('[StickerCam] image:file okunamadı, legacy deneniyor:', cause);
  }

  const base64 = await withTimeout(
    LegacyFileSystem.readAsStringAsync(sourceUri, {
      encoding: LegacyFileSystem.EncodingType.Base64,
    }),
    15_000,
    'Fotoğraf yüklenmesi zaman aşımına uğradı.',
  );

  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(base64));
  if (!image) {
    throw new Error('Fotoğraf çözümlenemedi.');
  }

  return image;
}
