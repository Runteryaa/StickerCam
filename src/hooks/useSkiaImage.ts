import { useEffect, useState } from 'react';
import type { SkImage } from '@shopify/react-native-skia';

import { loadSkiaImage } from '@/services/skiaImageLoader';

type LoadedImage = {
  uri: string;
  image: SkImage | null;
  error: string | null;
};

type SkiaImageState = {
  image: SkImage | null;
  error: string | null;
};

/**
 * Editörde gösterilecek görseli yükler ve hata durumunu ekranda
 * gösterilebilir hale getirir.
 */
export function useSkiaImage(uri: string | null | undefined): SkiaImageState {
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!uri) {
      return () => {
        cancelled = true;
      };
    }

    const requestedUri = uri;

    async function load() {
      try {
        const image = await loadSkiaImage(requestedUri);

        if (!cancelled) {
          setLoaded({ uri: requestedUri, image, error: null });
        }
      } catch (cause) {
        console.warn('[StickerCam] Fotoğraf yüklenemedi:', requestedUri, cause);
        if (!cancelled) {
          setLoaded({
            uri: requestedUri,
            image: null,
            error:
              cause instanceof Error && cause.message
                ? cause.message
                : 'Fotoğraf yüklenemedi. Geri dönüp tekrar deneyebilirsin.',
          });
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [uri]);

  if (!uri) {
    return { image: null, error: null };
  }

  // URI değiştiğinde eski görseli göstermemek için sonucu URI ile eşleştiriyoruz.
  if (loaded?.uri !== uri) {
    return { image: null, error: null };
  }

  return { image: loaded.image, error: loaded.error };
}
