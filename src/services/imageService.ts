import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Editörde işlenecek görsellerin en uzun kenarı. Skia tarafında bellek ve
 * kesim kalitesi arasında iyi bir denge sağlar.
 */
const MAX_EDIT_DIMENSION = 2048;

export type PreparedPhoto = {
  uri: string;
  width: number;
  height: number;
};

/**
 * Kamera/galeri görselini editöre hazırlar.
 *
 * - EXIF orientation'ı "pişirir" (Skia encoded görsellerde EXIF yönünü uygulamaz).
 * - Çok büyük fotoğrafları decode sırasında makul bir çözünürlüğe indirir.
 * - Yeni dosyayı cache dizinine yazar.
 */
export async function preparePhoto(uri: string): Promise<PreparedPhoto> {
  const context = ImageManipulator.manipulate(uri, {
    maxWidth: MAX_EDIT_DIMENSION,
    maxHeight: MAX_EDIT_DIMENSION,
  });

  const image = await context.renderAsync();
  const saved = await image.saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.94,
  });

  return {
    uri: saved.uri,
    width: saved.width,
    height: saved.height,
  };
}
