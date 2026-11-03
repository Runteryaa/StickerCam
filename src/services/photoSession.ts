import type { StickerSource } from './stickerService';

type PendingPhoto = {
  uri: string;
  source: StickerSource;
  /**
   * Görselin şeffaflık içerdiği bilgisi. Kırpmaya zorlamamak ve şeffaflığı
   * bozmadan kaydetmek için kullanılır.
   */
  hasAlpha?: boolean;
};

/**
 * Editörde işlenecek fotoğrafı route parametresi olarak taşımıyoruz.
 *
 * Dosya URI'leri Expo Router parametrelerinden geçerken birden fazla kez
 * URL-decode edilebiliyor. Expo Go'nun önbellek yolu `%40anonymous%2F...`
 * gibi litera percent karakterleri içerdiği için bu, dosyanın bulunamamasına
 * yol açıyor. URI'yi kısa süreliğine burada tutup editör açılınca okuyoruz.
 */

let pendingPhoto: PendingPhoto | null = null;

type PendingPhotoListener = (photo: PendingPhoto) => void;

const listeners = new Set<PendingPhotoListener>();

function notify(photo: PendingPhoto): void {
  for (const listener of listeners) {
    listener(photo);
  }
}

export function setPendingPhoto(photo: PendingPhoto): void {
  pendingPhoto = photo;
  notify(photo);
}

export function getPendingPhoto(): PendingPhoto | null {
  return pendingPhoto;
}

export function clearPendingPhoto(): void {
  pendingPhoto = null;
}

/**
 * Editör açıkken yeni bir fotoğraf gelirse (ör. uygulama açıkken başka bir
 * uygulamadan paylaşım) editörün içeriğini tazelemek için kullanılır.
 */
export function subscribePendingPhoto(listener: PendingPhotoListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
