import { usePathname, useRootNavigationState, router } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { preparePhoto } from '@/services/imageService';
import { setPendingPhoto } from '@/services/photoSession';
import { consumeSharedImages, subscribeToSharedImages } from '@/services/sharedImageService';
import { withTimeout } from '@/utils/withTimeout';

/**
 * Başka uygulamalardan gelen görselleri karşılar ve doğrudan editörü açar.
 *
 * Paylaşım uygulama kapalıyken de gelebilir (cold start), açıkken de
 * (`onNewIntent`). İki durumda da native tarafta bekleyen dosyalar
 * `consumeSharedImages` ile alınır.
 */
export function useSharedImageIntake(): void {
  const navigationState = useRootNavigationState();
  const pathname = usePathname();
  const navigationReady = Boolean(navigationState?.key);
  const pathnameRef = useRef(pathname);
  const busyRef = useRef(false);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const handlePending = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    try {
      const images = await consumeSharedImages();
      const first = images[0];
      if (!first) {
        return;
      }

      const prepared = await withTimeout(
        preparePhoto(first.uri, {
          mimeType: first.mimeType,
          fileName: first.fileName,
        }),
        15_000,
        'Paylaşılan görsel işlenemedi.',
      );

      setPendingPhoto({
        uri: prepared.uri,
        source: 'share',
        hasAlpha: prepared.hasAlpha,
      });

      if (pathnameRef.current === '/editor') {
        router.replace('/editor');
      } else {
        router.push('/editor');
      }
    } catch (error) {
      console.warn('[StickerCam] Paylaşılan görsel açılamadı', error);
    } finally {
      busyRef.current = false;
    }
  }, []);

  // Yeni paylaşım geldiğinde (uygulama açıkken) tetiklenir.
  useEffect(() => {
    if (!navigationReady) {
      return;
    }
    return subscribeToSharedImages(() => {
      void handlePending();
    });
  }, [handlePending, navigationReady]);

  // Uygulama paylaşımla açıldığında (cold start).
  useEffect(() => {
    if (!navigationReady) {
      return;
    }
    void handlePending();
  }, [handlePending, navigationReady]);
}
