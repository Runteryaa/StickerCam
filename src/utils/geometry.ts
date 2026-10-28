export type Point = { x: number; y: number };

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Görseli, verilen kutu içine "contain" mantığıyla ortalar.
 */
export function containRect(
  imageWidth: number,
  imageHeight: number,
  boxWidth: number,
  boxHeight: number,
): Rect {
  if (imageWidth <= 0 || imageHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (boxWidth - width) / 2,
    y: (boxHeight - height) / 2,
    width,
    height,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Görünür alandaki (ekran koordinatı) bir noktayı görselin piksel koordinatına çevirir.
 */
export function viewPointToImage(
  point: Point,
  fit: Rect,
  imageSize: { width: number; height: number },
): Point {
  if (fit.width <= 0 || fit.height <= 0) {
    return { x: 0, y: 0 };
  }
  const scaleX = imageSize.width / fit.width;
  const scaleY = imageSize.height / fit.height;
  return {
    x: clamp((point.x - fit.x) * scaleX, 0, imageSize.width),
    y: clamp((point.y - fit.y) * scaleY, 0, imageSize.height),
  };
}

/**
 * Kullanıcının ekranda çizdiği noktaları görsel piksel uzayına taşır.
 */
export function mapPointsToImage(
  points: Point[],
  fit: Rect,
  imageSize: { width: number; height: number },
): Point[] {
  return points.map((point) => viewPointToImage(point, fit, imageSize));
}
