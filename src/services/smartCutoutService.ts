import { Platform } from 'react-native';

import SmartCutout from '../../modules/smart-cutout';
import type { Point } from '@/utils/geometry';

/**
 * Akıllı kesim köprüsü.
 *
 * Android'de MediaPipe (MagicTouch) tabanlı native modül kullanılır: model
 * uygulamanın içinde gelir, internete ihtiyaç duymaz. iOS'ta modül bulunmadığı
 * için `null` döner ve çağıran taraf yerel yedek algoritmaya geçer.
 */

/** Modelin çalıştığı en uzun kenar. */
const MAX_DIMENSION = 1024;

export type SmartCutoutSession = {
  width: number;
  height: number;
  /** Model hazırlık sırasında yüklenebildi mi? */
  modelLoaded: boolean;
  /** Model yüklenemediyse nedeni. */
  error: string | null;
};

export function isNativeSmartCutoutAvailable(): boolean {
  return Platform.OS === 'android' && SmartCutout !== null;
}

/** Görseli modele hazırlar (ağır özellik çıkarımı burada yapılır). */
export async function prepareSmartCutout(uri: string): Promise<SmartCutoutSession> {
  if (!SmartCutout) {
    throw new Error('Akıllı kesim modülü bu cihazda bulunmuyor.');
  }
  return SmartCutout.prepareAsync(uri, MAX_DIMENSION);
}

/**
 * Vuruşlarla maske üretir.
 *
 * Noktalar görsel piksel koordinatındadır; native tarafa 0..1 normalize
 * edilerek gönderilir. Her vuruş `-1, -1` ayırıcısıyla ayrılır: model böylece
 * iki ayrı dokunuşu tek bir fırça çizgisi olarak birleştirmez.
 */
export async function segmentSmartCutout(
  imageSize: { width: number; height: number },
  positiveStrokes: Point[][],
  negativeStrokes: Point[][],
): Promise<{ uri: string; width: number; height: number }> {
  if (!SmartCutout) {
    throw new Error('Akıllı kesim modülü bu cihazda bulunmuyor.');
  }

  const toFlat = (strokes: Point[][]): number[] => {
    const flat: number[] = [];
    for (const stroke of strokes) {
      if (stroke.length === 0) {
        continue;
      }
      if (flat.length > 0) {
        flat.push(-1, -1);
      }
      for (const point of stroke) {
        flat.push(
          clamp01(point.x / imageSize.width),
          clamp01(point.y / imageSize.height),
        );
      }
    }
    return flat;
  };

  return SmartCutout.segmentAsync(toFlat(positiveStrokes), toFlat(negativeStrokes));
}

/** Modeli ve önbellekteki görseli serbest bırakır. */
export async function closeSmartCutout(): Promise<void> {
  if (!SmartCutout) {
    return;
  }
  try {
    await SmartCutout.closeAsync();
  } catch {
    // Oturum zaten kapanmış olabilir.
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
