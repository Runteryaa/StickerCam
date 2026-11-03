import { NativeModule, requireOptionalNativeModule } from 'expo';

export type SmartCutoutSize = {
  width: number;
  height: number;
};

export type SmartCutoutMask = {
  /** Cache'e yazılmış `file://` maske PNG'si (beyaz + güven alfası). */
  uri: string;
  width: number;
  height: number;
};

/**
 * MediaPipe MagicTouch tabanlı akıllı kesim modülü (yalnızca Android).
 *
 * Noktalar 0..1 aralığında normalize edilmiştir ve düz bir dizi olarak
 * verilir: `[x1, y1, x2, y2, ...]`.
 */
declare class SmartCutoutModule extends NativeModule {
  /** Görseli modele bir kez verir; sonraki seçimler bu sayede hızlıdır. */
  prepareAsync(uri: string, maxDimension: number): Promise<SmartCutoutSize>;
  /** Pozitif/negatif vuruşlarla maske üretir. */
  segmentAsync(positivePoints: number[], negativePoints: number[]): Promise<SmartCutoutMask>;
  /** Modeli ve görseli serbest bırakır. */
  closeAsync(): Promise<void>;
}

/**
 * iOS'ta modül yoktur; `null` döndüğünde yerel renk tabanlı yedek algoritma
 * devreye girer.
 */
export default requireOptionalNativeModule<SmartCutoutModule>('SmartCutout');
