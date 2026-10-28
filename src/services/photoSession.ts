import type { StickerSource } from './stickerService';

type PendingPhoto = {
  uri: string;
  source: StickerSource;
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

export function setPendingPhoto(photo: PendingPhoto): void {
  pendingPhoto = photo;
}

export function getPendingPhoto(): PendingPhoto | null {
  return pendingPhoto;
}

export function clearPendingPhoto(): void {
  pendingPhoto = null;
}
