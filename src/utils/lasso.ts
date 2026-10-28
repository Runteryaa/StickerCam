import { Skia, type SkPath } from '@shopify/react-native-skia';

import type { Point } from './geometry';

/**
 * Serbest çizim noktalarından yumuşatılmış, kapalı bir lasso path'i üretir.
 *
 * Hem UI thread'inde (useDerivedValue) hem de JS thread'inde (kırpma anında)
 * çağrılabildiği için worklet olarak işaretlenmiştir.
 */
export function buildLassoPath(points: Point[]): SkPath {
  'worklet';
  const path = Skia.PathBuilder.Make();
  if (points.length === 0) {
    return path.build();
  }

  const first = points[0];
  path.moveTo(first.x, first.y);

  if (points.length === 1) {
    path.lineTo(first.x, first.y);
    return path.build();
  }

  // Köşeleri yumuşatmak için orta noktalardan geçen quadratic eğriler.
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    path.quadTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }

  const last = points[points.length - 1];
  path.lineTo(last.x, last.y);
  path.close();
  return path.build();
}

export function pathArea(path: SkPath): number {
  const bounds = path.getBounds();
  return bounds.width * bounds.height;
}
