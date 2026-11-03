import { Platform } from 'react-native';

import ShareIntent, { type SharedImage } from '../../modules/share-intent';

export type { SharedImage };

/**
 * Başka uygulamalardan görsel paylaşımı şu anda yalnızca Android'de desteklenir.
 * iOS'ta bunun için ayrı bir Share Extension hedefi gerekir.
 */
export function isShareTargetSupported(): boolean {
  return Platform.OS === 'android' && ShareIntent !== null;
}

/**
 * Bekleyen paylaşımları okur. Gelen `content://` uri'leri native tarafta
 * cache'e kopyalanmıştır; bu yüzden dönen uri'ler kalıcı `file://` yollarıdır.
 */
export async function consumeSharedImages(): Promise<SharedImage[]> {
  if (!ShareIntent) {
    return [];
  }
  try {
    return await ShareIntent.consumeSharedImagesAsync();
  } catch {
    return [];
  }
}

/**
 * Uygulama açıkken yeni bir paylaşım geldiğinde tetiklenir.
 * Dönen fonksiyon aboneliği kaldırır.
 */
export function subscribeToSharedImages(listener: () => void): () => void {
  if (!ShareIntent) {
    return () => {};
  }
  const subscription = ShareIntent.addListener('onShareReceived', listener);
  return () => subscription.remove();
}
