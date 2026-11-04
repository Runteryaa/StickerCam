import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Canvas,
  Group,
  Image as SkiaImage,
  ImageFormat,
  Path,
  Rect as SkiaRect,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Check, Crop, Eraser, Pencil, Plus, RotateCcw, Scissors, Sparkles, Wand2 } from 'lucide-react-native';

import { ActionButton } from '@/components/ActionButton';
import { TransparencyPreview } from '@/components/TransparencyPreview';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useSkiaImage } from '@/hooks/useSkiaImage';
import { isSmartSelectionAvailable, segmentMask } from '@/services/segmentationService';
import { loadSkiaImage } from '@/services/skiaImageLoader';
import {
  closeSmartCutout,
  isNativeSmartCutoutAvailable,
  prepareSmartCutout,
} from '@/services/smartCutoutService';
import {
  commitSticker,
  discardStaged,
  stageSticker,
  type StagedSticker,
  type StickerRecord,
  type StickerSource,
} from '@/services/stickerService';
import { containRect, viewPointToImage, type Point, type Rect } from '@/utils/geometry';
import { buildLassoPath, buildPolygonPath } from '@/utils/lasso';
import {
  applyMask,
  cutOutWithPath,
  finalizeSticker,
  finalizeStickerAsIs,
} from '@/utils/stickerImage';

type SelectionMode = 'lasso' | 'quad' | 'ai';

type ObjectCutterProps = {
  imageUri: string;
  source?: StickerSource;
  /** Görselin şeffaflık içerdiği bilgisi (paylaşılan hazır sticker'larda). */
  hasAlpha?: boolean;
  onClose: () => void;
  onSaved: (sticker: StickerRecord) => void;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Beklenmeyen bir hata oluştu. Tekrar deneyebilirsin.';
}

/** Vuruşlardaki toplam nokta sayısı. */
function countPoints(strokes: Point[][]): number {
  return strokes.reduce((total, stroke) => total + stroke.length, 0);
}

/** Işın atma yöntemiyle noktanın çokgenin içinde olup olmadığını söyler. */
function pointInPolygon(points: Point[], x: number, y: number): boolean {
  'worklet';
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    const crosses = yi > y !== yj > y;
    if (crosses && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Noktanın doğru parçasına uzaklığı ve en yakın noktası. */
function segmentHit(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { distance: number; x: number; y: number } {
  'worklet';
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / lengthSq)) : 0;
  const px = ax + t * dx;
  const py = ay + t * dy;
  return { distance: Math.hypot(x - px, y - py), x: px, y: py };
}

/** Köşe tutamacının dokunma yarıçapı (görünür piksel). */
const VERTEX_HIT_RADIUS = 40;
/** Kenara dokunarak köşe ekleme yarıçapı (görünür piksel). */
const EDGE_HIT_RADIUS = 26;
/** Bir dokunuşun "sürükleme" sayılması için gereken mesafe. */
const TAP_SLOP = 9;
/** Çift dokunuşla köşe silme aralığı. */
const DOUBLE_TAP_MS = 420;

export function ObjectCutter({
  imageUri,
  source = 'camera',
  hasAlpha = false,
  onClose,
  onSaved,
}: ObjectCutterProps) {
  const insets = useSafeAreaInsets();
  const { image, error: imageError } = useSkiaImage(imageUri);
  const smartSelectionReady = useMemo(() => isSmartSelectionAvailable(), []);

  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [mode, setMode] = useState<SelectionMode>('lasso');
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState<StagedSticker | null>(null);
  const [saving, setSaving] = useState(false);

  const points = useSharedValue<Point[]>([]);
  const lassoPath = useDerivedValue(() => buildLassoPath(points.value));

  // Akıllı seçim: model durumlu olduğu için seçim boyunca açık tutulur.
  const [smartPreview, setSmartPreview] = useState<SkImage | null>(null);
  const [smartBrush, setSmartBrush] = useState<'add' | 'remove'>('add');
  const [smartCounts, setSmartCounts] = useState({ positive: 0, negative: 0 });
  const [smartPreparing, setSmartPreparing] = useState(false);
  const [smartEngine, setSmartEngine] = useState<'model' | 'fallback' | null>(null);
  const [smartNote, setSmartNote] = useState<string | null>(null);
  /** Her dizi ayrı bir vuruş: dokunuş = tek nokta, sürükleme = çizgi. */
  const smartPositive = useRef<Point[][]>([]);
  const smartNegative = useRef<Point[][]>([]);
  const smartStroke = useSharedValue<Point[]>([]);
  const smartPath = useDerivedValue(() => buildLassoPath(smartStroke.value));
  const prepareRef = useRef<Promise<unknown> | null>(null);
  const lastCornerTap = useRef<{ index: number; time: number } | null>(null);

  // Çokgen seçimi: köşe sayısı serbest, köşeler görünür alan koordinatında.
  const quadCorners = useSharedValue<Point[]>([]);
  const quadPath = useDerivedValue(() => buildPolygonPath(quadCorners.value));
  const quadHandles = useDerivedValue(() => {
    const path = Skia.PathBuilder.Make();
    for (const corner of quadCorners.value) {
      path.addCircle(corner.x, corner.y, 11);
    }
    return path.build();
  });
  const dragCorner = useSharedValue(-1);
  const dragStart = useSharedValue<Point>({ x: 0, y: 0 });
  const dragFrom = useSharedValue<Point[]>([]);
  const dragEnd = useSharedValue<Point>({ x: 0, y: 0 });
  const dragMoved = useSharedValue(0);
  /** 0 = yok, 1 = köşe, 2 = tüm şekil, 3 = kenara dokunma (köşe ekle). */
  const dragKind = useSharedValue(0);
  const loupeVisible = useSharedValue(false);
  const loupeCenter = useSharedValue<Point>({ x: 0, y: 0 });

  /**
   * Büyüteç: sürüklenen köşenin etrafı 2,6× büyütülür. Parmak köşeyi
   * kapatmasın diye ekranın boş yarısına yerleştirilir.
   */
  const loupeLayout = useDerivedValue(() => {
    const center = loupeCenter.value;
    const radius = 56;
    const placeBottom = center.y < stageSize.height * 0.5;
    return {
      x: stageSize.width / 2,
      y: placeBottom ? stageSize.height - radius - 26 : radius + 26,
      radius,
    };
  });

  const loupeClip = useDerivedValue(() => {
    const layout = loupeLayout.value;
    const path = Skia.PathBuilder.Make();
    path.addCircle(layout.x, layout.y, layout.radius);
    return path.build();
  });

  const loupeTransform = useDerivedValue(() => {
    const layout = loupeLayout.value;
    const center = loupeCenter.value;
    return [
      { translateX: layout.x },
      { translateY: layout.y },
      { scale: 2.6 },
      { translateX: -center.x },
      { translateY: -center.y },
    ];
  });

  const loupeOpacity = useDerivedValue(() => (loupeVisible.value ? 1 : 0));

  const stagedRef = useRef<StagedSticker | null>(null);

  const imageSize = useMemo(
    () => ({ width: image?.width() ?? 0, height: image?.height() ?? 0 }),
    [image],
  );

  const fit = useMemo(
    () => containRect(imageSize.width, imageSize.height, stageSize.width, stageSize.height),
    [imageSize.height, imageSize.width, stageSize.height, stageSize.width],
  );

  /** Görselin içine %8 boşluk bırakan varsayılan dörtgen. */
  const makeDefaultCorners = useCallback((rect: Rect): Point[] => {
    if (rect.width <= 0 || rect.height <= 0) {
      return [];
    }
    const insetX = rect.width * 0.08;
    const insetY = rect.height * 0.08;
    return [
      { x: rect.x + insetX, y: rect.y + insetY },
      { x: rect.x + rect.width - insetX, y: rect.y + insetY },
      { x: rect.x + rect.width - insetX, y: rect.y + rect.height - insetY },
      { x: rect.x + insetX, y: rect.y + rect.height - insetY },
    ];
  }, []);

  useEffect(() => {
    if (mode !== 'quad' || !image || fit.width <= 0 || fit.height <= 0) {
      return;
    }
    quadCorners.value = makeDefaultCorners(fit);
  }, [fit, image, makeDefaultCorners, mode, quadCorners]);

  const openDraft = useCallback((finalImage: SkImage, stickerSource: StickerSource) => {
    const base64 = finalImage.encodeToBase64(ImageFormat.PNG, 100);
    const staged = stageSticker({
      base64,
      width: finalImage.width(),
      height: finalImage.height(),
      source: stickerSource,
    });
    stagedRef.current = staged;
    setDraft(staged);
  }, []);

  /**
   * Kırpma yapmadan kaydetme. Paylaşılan bir görsel zaten sticker olabilir;
   * bu yüzden seçim zorunlu değil. Şeffaflık ve renkler olduğu gibi korunur.
   */
  const handleDirectExtract = useCallback(() => {
    if (!image) {
      return;
    }
    setBusy(true);
    setStatus('Sticker hazırlanıyor…');
    try {
      openDraft(finalizeStickerAsIs(image), source);
      setStatus(null);
    } catch (error) {
      Alert.alert('Sticker oluşturulamadı', errorMessage(error));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [image, openDraft, source]);

  const handleManualExtract = useCallback(async () => {
    if (!image) {
      return;
    }
    const viewPoints = mode === 'quad' ? quadCorners.value : points.value;
    if (viewPoints.length < 3) {
      setStatus(
        mode === 'quad'
          ? 'Önce dört köşeyi yerleştir.'
          : 'Önce parmağınla nesnenin etrafını çiz.',
      );
      return;
    }

    setBusy(true);
    setStatus('Nesne kesiliyor…');
    try {
      const imagePoints = viewPoints.map((point) =>
        viewPointToImage(point, fit, imageSize),
      );
      const path =
        mode === 'quad'
          ? buildPolygonPath(imagePoints)
          : buildLassoPath(imagePoints);
      const cutout = cutOutWithPath(image, path, imageSize);
      if (!cutout) {
        throw new Error('Seçim çok küçük görünüyor. Daha geniş bir alan seç.');
      }
      openDraft(finalizeSticker(cutout), source);
      setStatus(null);
    } catch (error) {
      Alert.alert('Sticker oluşturulamadı', errorMessage(error));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [fit, image, imageSize, mode, openDraft, points, quadCorners, source]);

  /**
   * Akıllı seçim oturumu: görsel modele bir kez verilir (ağır özellik
   * çıkarımı), sonraki dokunuşlar yalnızca maske üretir ve hızlıdır.
   */
  useEffect(() => {
    if (mode !== 'ai' || !image || !isNativeSmartCutoutAvailable()) {
      return;
    }
    let cancelled = false;

    const prepare = async () => {
      setSmartPreparing(true);
      const promise = prepareSmartCutout(imageUri);
      prepareRef.current = promise;
      try {
        const session = await promise;
        if (!cancelled) {
          // Model yüklenemediyse ya da deneme segmentasyonu düştüyse nedenini
          // hemen göster; kullanıcı ilk dokunuştan önce durumu bilsin.
          if (!session.modelLoaded) {
            setSmartEngine('fallback');
            setSmartNote(session.error ?? 'model yüklenemedi');
            console.warn('[StickerCam] Akıllı kesim modeli yüklenemedi:', session.error);
          } else if (session.selfTest) {
            setSmartEngine('fallback');
            setSmartNote(`model çalışmadı: ${session.selfTest}`);
            console.warn('[StickerCam] Model yüklendi ama segmentasyon başarısız:', session.selfTest);
          } else {
            setSmartEngine('model');
            setSmartNote(
              session.engine === 'magictouch-legacy' ? 'uyumluluk motoru' : null,
            );
          }
        }
      } catch (error) {
        if (!cancelled) {
          setSmartEngine('fallback');
          setSmartNote(errorMessage(error));
        }
        console.warn('[StickerCam] Akıllı kesim modeli hazırlanamadı', error);
      } finally {
        if (!cancelled) {
          setSmartPreparing(false);
        }
      }
    };

    void prepare();

    return () => {
      cancelled = true;
      prepareRef.current = null;
    };
  }, [image, imageUri, mode]);

  // Editörden çıkarken modeli ve görseli serbest bırak.
  useEffect(() => {
    return () => {
      void closeSmartCutout();
    };
  }, []);

  const runSmartSegmentation = useCallback(
    async (positiveStrokes: Point[][], negativeStrokes: Point[][]) => {
      if (!image) {
        return;
      }
      setBusy(true);
      setStatus('Nesne seçiliyor…');
      try {
        // Model henüz yüklenmediyse dokunuşu kaybetmek yerine bekle.
        if (isNativeSmartCutoutAvailable() && prepareRef.current) {
          try {
            await prepareRef.current;
          } catch {
            // Model yüklenemedi; aşağıdaki sağlayıcı zinciri yedeğe düşer.
          }
        }

        const maskResult = await segmentMask({
          imageUri,
          image,
          imageSize,
          positiveStrokes,
          negativeStrokes,
        });
        const mask = await loadSkiaImage(maskResult.uri);
        const cutout = applyMask(image, mask);
        if (!cutout) {
          throw new Error('Kesim oluşturulamadı. Başka bir noktayı dene.');
        }
        setSmartPreview(cutout);
        setSmartEngine(maskResult.provider === 'mediapipe' ? 'model' : 'fallback');
        setSmartNote(maskResult.note ?? null);
        setStatus(null);
      } catch (error) {
        setStatus(errorMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [image, imageSize, imageUri],
  );

  /**
   * Dokunma veya sürükleme ile gelen vuruşu seçime ekler/çıkarır.
   *
   * Noktalar görsel piksel koordinatına çevrilir; böylece maske her zaman
   * orijinal çözünürlükte üretilir.
   */
  const handleSmartStroke = useCallback(
    (viewPoints: Point[]) => {
      if (!image || viewPoints.length === 0) {
        return;
      }

      const insidePhoto = viewPoints.filter(
        (point) =>
          point.x >= fit.x &&
          point.x <= fit.x + fit.width &&
          point.y >= fit.y &&
          point.y <= fit.y + fit.height,
      );
      if (insidePhoto.length === 0) {
        setStatus('Kesmek istediğin nesnenin üzerine dokun.');
        return;
      }

      if (smartBrush === 'remove' && smartPositive.current.length === 0) {
        setStatus('Önce seçmek istediğin nesneye dokun.');
        return;
      }

      // Görsel piksel koordinatına çevir; maske her zaman orijinal
      // çözünürlükte üretilir.
      const stroke = insidePhoto.map((point) =>
        viewPointToImage(point, fit, imageSize),
      );

      // Her dokunuş/sürükleme ayrı bir vuruş olarak saklanır.
      if (smartBrush === 'add') {
        smartPositive.current = [...smartPositive.current, stroke];
      } else {
        smartNegative.current = [...smartNegative.current, stroke];
      }

      setSmartCounts({
        positive: countPoints(smartPositive.current),
        negative: countPoints(smartNegative.current),
      });

      void runSmartSegmentation(smartPositive.current, smartNegative.current);
    },
    [fit, image, imageSize, runSmartSegmentation, smartBrush],
  );

  const handleSmartReset = useCallback(() => {
    smartPositive.current = [];
    smartNegative.current = [];
    setSmartCounts({ positive: 0, negative: 0 });
    setSmartPreview(null);
    setSmartBrush('add');
    setSmartEngine(null);
    setSmartNote(null);
    setStatus(null);
  }, []);

  const handleSmartConfirm = useCallback(() => {
    if (!smartPreview) {
      return;
    }
    openDraft(finalizeSticker(smartPreview), 'ai');
  }, [openDraft, smartPreview]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!busy)
        .minDistance(0)
        .maxPointers(1)
        .onBegin((event) => {
          points.value = [{ x: event.x, y: event.y }];
          runOnJS(setHasSelection)(false);
          runOnJS(setStatus)(null);
        })
        .onUpdate((event) => {
          const current = points.value;
          const last = current[current.length - 1];
          if (last && Math.hypot(event.x - last.x, event.y - last.y) < 2) {
            return;
          }
          if (current.length >= 1500) {
            return;
          }
          if (current.length === 1) {
            runOnJS(setIsDrawing)(true);
          }
          points.value = current.concat([{ x: event.x, y: event.y }]);
        })
        .onFinalize(() => {
          const count = points.value.length;
          runOnJS(setIsDrawing)(false);
          runOnJS(setHasSelection)(count >= 3);
        }),
    [busy, points],
  );

  /**
   * Akıllı seçim jesti: dokunma tek noktalı, sürükleme çok noktalı bir vuruş
   * üretir. Böylece hem "nesneye dokun" hem "nesnenin üzerinden geçir"
   * çalışır.
   */
  const smartGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!busy)
        .minDistance(0)
        .maxPointers(1)
        .onBegin((event) => {
          smartStroke.value = [{ x: event.x, y: event.y }];
          runOnJS(setStatus)(null);
        })
        .onUpdate((event) => {
          const current = smartStroke.value;
          const last = current[current.length - 1];
          if (last && Math.hypot(event.x - last.x, event.y - last.y) < 3) {
            return;
          }
          if (current.length >= 800) {
            return;
          }
          smartStroke.value = current.concat([{ x: event.x, y: event.y }]);
        })
        .onFinalize(() => {
          const stroke = smartStroke.value;
          smartStroke.value = [];
          if (stroke.length > 0) {
            runOnJS(handleSmartStroke)(stroke);
          }
        }),
    [busy, handleSmartStroke, smartStroke],
  );

  /**
   * Kenara dokununca araya yeni bir köşe ekler; çokgenin şekli bozulmaz,
   * kullanıcı yeni tutamacı istediği yere sürükler.
   */
  const insertCornerAt = useCallback(
    (x: number, y: number) => {
      const corners = quadCorners.value;
      if (corners.length < 3) {
        return;
      }

      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      let bestPoint: Point | null = null;

      for (let index = 0; index < corners.length; index += 1) {
        const a = corners[index];
        const b = corners[(index + 1) % corners.length];
        const hit = segmentHit(x, y, a.x, a.y, b.x, b.y);
        if (hit.distance < bestDistance) {
          bestDistance = hit.distance;
          bestIndex = index;
          bestPoint = { x: hit.x, y: hit.y };
        }
      }

      if (bestIndex < 0 || !bestPoint || bestDistance > EDGE_HIT_RADIUS) {
        return;
      }

      const next = corners.slice();
      next.splice(bestIndex + 1, 0, bestPoint);
      quadCorners.value = next;
      setHasSelection(true);
      setStatus('Köşe eklendi. Sürükleyerek yerleştir.');
    },
    [quadCorners],
  );

  /** Köşeyi siler (en az üç köşe kalmalı). */
  const removeCorner = useCallback(
    (index: number) => {
      const corners = quadCorners.value;
      if (corners.length <= 3) {
        setStatus('En az üç köşe gerekli.');
        return;
      }
      const next = corners.filter((_, position) => position !== index);
      quadCorners.value = next;
      setHasSelection(true);
      setStatus('Köşe silindi.');
    },
    [quadCorners],
  );

  /** Köşeye çift dokunuşu algılar; ikinci dokunuşta köşeyi siler. */
  const handleCornerTap = useCallback(
    (index: number) => {
      const now = Date.now();
      const last = lastCornerTap.current;
      if (last && last.index === index && now - last.time < DOUBLE_TAP_MS) {
        lastCornerTap.current = null;
        removeCorner(index);
        return;
      }
      lastCornerTap.current = { index, time: now };
    },
    [removeCorner],
  );

  /**
   * Çokgen seçimi:
   *  - köşe tutamacını sürükle → yalnızca o köşe taşınır (büyüteç açılır),
   *  - şeklin içinden sürükle → tüm çokgen taşınır,
   *  - kenara dokun → araya köşe eklenir,
   *  - köşeye çift dokun → köşe silinir.
   */
  const quadGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!busy)
        .minDistance(0)
        .maxPointers(1)
        .onBegin((event) => {
          const corners = quadCorners.value;
          dragFrom.value = corners;
          dragStart.value = { x: event.x, y: event.y };
          dragEnd.value = { x: event.x, y: event.y };
          dragMoved.value = 0;
          dragCorner.value = -1;
          dragKind.value = 0;
          loupeVisible.value = false;
          runOnJS(setStatus)(null);

          if (corners.length < 3) {
            return;
          }

          let nearest = -1;
          let nearestDistance = Number.POSITIVE_INFINITY;
          for (let index = 0; index < corners.length; index += 1) {
            const distance = Math.hypot(
              corners[index].x - event.x,
              corners[index].y - event.y,
            );
            if (distance < nearestDistance) {
              nearestDistance = distance;
              nearest = index;
            }
          }

          if (nearestDistance <= VERTEX_HIT_RADIUS) {
            dragKind.value = 1;
            dragCorner.value = nearest;
            loupeCenter.value = corners[nearest];
            loupeVisible.value = true;
            return;
          }

          let edgeDistance = Number.POSITIVE_INFINITY;
          for (let index = 0; index < corners.length; index += 1) {
            const a = corners[index];
            const b = corners[(index + 1) % corners.length];
            const hit = segmentHit(event.x, event.y, a.x, a.y, b.x, b.y);
            if (hit.distance < edgeDistance) {
              edgeDistance = hit.distance;
            }
          }
          if (edgeDistance <= EDGE_HIT_RADIUS) {
            dragKind.value = 3;
            return;
          }

          if (pointInPolygon(corners, event.x, event.y)) {
            dragKind.value = 2;
          }
        })
        .onUpdate((event) => {
          const from = dragFrom.value;
          dragEnd.value = { x: event.x, y: event.y };

          const moved = Math.hypot(
            event.x - dragStart.value.x,
            event.y - dragStart.value.y,
          );
          if (moved > dragMoved.value) {
            dragMoved.value = moved;
          }

          if (from.length < 3) {
            return;
          }

          const left = fit.x;
          const top = fit.y;
          const right = fit.x + fit.width;
          const bottom = fit.y + fit.height;

          if (dragKind.value === 1 && dragCorner.value >= 0) {
            const index = dragCorner.value;
            const next = from.slice();
            next[index] = {
              x: Math.min(Math.max(event.x, left), right),
              y: Math.min(Math.max(event.y, top), bottom),
            };
            quadCorners.value = next;
            loupeCenter.value = next[index];
            return;
          }

          if (dragKind.value !== 2) {
            return;
          }

          let minX = Number.POSITIVE_INFINITY;
          let minY = Number.POSITIVE_INFINITY;
          let maxX = Number.NEGATIVE_INFINITY;
          let maxY = Number.NEGATIVE_INFINITY;
          for (const corner of from) {
            minX = Math.min(minX, corner.x);
            minY = Math.min(minY, corner.y);
            maxX = Math.max(maxX, corner.x);
            maxY = Math.max(maxY, corner.y);
          }

          const deltaX = Math.min(
            Math.max(event.x - dragStart.value.x, left - minX),
            right - maxX,
          );
          const deltaY = Math.min(
            Math.max(event.y - dragStart.value.y, top - minY),
            bottom - maxY,
          );

          quadCorners.value = from.map((corner) => ({
            x: corner.x + deltaX,
            y: corner.y + deltaY,
          }));
        })
        .onFinalize(() => {
          const kind = dragKind.value;
          const index = dragCorner.value;
          if (kind === 3 && dragMoved.value < TAP_SLOP) {
            runOnJS(insertCornerAt)(dragEnd.value.x, dragEnd.value.y);
          } else if (kind === 1 && index >= 0 && dragMoved.value < TAP_SLOP) {
            runOnJS(handleCornerTap)(index);
          }

          dragKind.value = 0;
          dragCorner.value = -1;
          loupeVisible.value = false;
          runOnJS(setHasSelection)(true);
        }),
    [
      busy,
      dragCorner,
      dragEnd,
      dragFrom,
      dragKind,
      dragMoved,
      dragStart,
      fit,
      handleCornerTap,
      insertCornerAt,
      loupeCenter,
      loupeVisible,
      quadCorners,
    ],
  );

  const handleReset = useCallback(() => {
    if (mode === 'quad') {
      quadCorners.value = makeDefaultCorners(fit);
      setHasSelection(true);
    } else {
      points.value = [];
      setHasSelection(false);
    }
    setIsDrawing(false);
    setStatus(null);
  }, [fit, makeDefaultCorners, mode, points, quadCorners]);

  const handleModeChange = useCallback(
    (next: SelectionMode) => {
      if (next === mode) {
        return;
      }
      setMode(next);
      setStatus(null);
      points.value = [];
      setIsDrawing(false);
      // Akıllı seçim moduna girerken/çıkarken önceki vuruşlar geçersizdir.
      smartPositive.current = [];
      smartNegative.current = [];
      setSmartCounts({ positive: 0, negative: 0 });
      setSmartPreview(null);
      setSmartBrush('add');
      setSmartEngine(null);
      setSmartNote(null);
      lastCornerTap.current = null;
      if (next === 'quad') {
        quadCorners.value = makeDefaultCorners(fit);
        setHasSelection(true);
      } else {
        setHasSelection(false);
      }
    },
    [fit, makeDefaultCorners, mode, points, quadCorners],
  );

  const handleDiscard = useCallback(() => {
    discardStaged(stagedRef.current);
    stagedRef.current = null;
    setDraft(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!draft) {
      return;
    }
    setSaving(true);
    try {
      const record = await commitSticker(draft);
      stagedRef.current = null;
      setDraft(null);
      onSaved(record);
    } catch (error) {
      Alert.alert('Sticker kaydedilemedi', errorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [draft, onSaved]);

  useEffect(
    () => () => {
      discardStaged(stagedRef.current);
      stagedRef.current = null;
    },
    [],
  );

  const instruction =
    mode === 'lasso'
      ? 'Parmağını nesnenin çevresinde gezdir; çizgi kendiliğinden kapanır.'
      : mode === 'quad'
        ? 'Köşeyi sürükle (büyüteç açılır), kenara dokun → yeni köşe, köşeye çift dokun → sil.'
        : smartSelectionReady
          ? 'Nesneye dokun; sonuç hemen görünür. Yanlış kalan yeri “Çıkar” ile işaretle.'
          : 'Akıllı kesim bu cihazda kullanılamıyor. Serbest çizim modunu deneyebilirsin.';

  const directSaveHint =
    hasAlpha
      ? 'Görsel zaten şeffaf; kırpmadan kaydedersen şeffaflığı korunur.'
      : 'Kırpma zorunlu değil; görselin tamamını sticker olarak kaydedebilirsin.';

  const canExtract = Boolean(image) && !busy;
  const hasActiveSelection =
    mode === 'quad' ? fit.width > 0 && fit.height > 0 : hasSelection;
  /**
   * Paylaşılan görseller ve şeffaf PNG'ler hazır sticker sayılır: kırpma
   * zorunlu değil, olduğu gibi kaydedilebilir.
   */
  const allowDirectSave = source === 'share' || hasAlpha;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.two }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Editörden çık"
          onPress={onClose}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
          <ArrowLeft size={20} color={Colors.paper} strokeWidth={2} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>STICKER ATÖLYESİ</Text>
          <Text style={styles.title}>Nesneyi seç</Text>
        </View>
        <View style={styles.stepChip}>
          <Text style={styles.stepText}>1 / 2</Text>
        </View>
      </View>

      <GestureDetector
        gesture={
          mode === 'lasso' ? panGesture : mode === 'quad' ? quadGesture : smartGesture
        }>
        <View
          style={styles.stage}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setStageSize({ width, height });
          }}>
          {image ? (
            <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
              {mode === 'ai' && smartPreview ? (
                // Önizleme görünürken orijinal fotoğraf arkada soluk kalır;
                // böylece "Çıkar" ile işaretlenecek bölgeler kaybolmuş olmaz.
                <Group opacity={0.18}>
                  <SkiaImage
                    image={image}
                    x={fit.x}
                    y={fit.y}
                    width={fit.width}
                    height={fit.height}
                    fit="contain"
                  />
                </Group>
              ) : null}
              <SkiaImage
                image={mode === 'ai' && smartPreview ? smartPreview : image}
                x={fit.x}
                y={fit.y}
                width={fit.width}
                height={fit.height}
                fit="contain"
              />
              {mode === 'ai' ? null : mode === 'quad' || isDrawing || hasSelection ? (
                <Group clip={mode === 'quad' ? quadPath : lassoPath} invertClip>
                  <SkiaRect
                    x={0}
                    y={0}
                    width={stageSize.width}
                    height={stageSize.height}
                    color="rgba(10, 7, 4, 0.6)"
                  />
                </Group>
              ) : null}
              <Path
                path={mode === 'quad' ? quadPath : lassoPath}
                style="stroke"
                strokeWidth={6}
                color="rgba(223, 95, 55, 0.32)"
                strokeJoin="round"
                strokeCap="round"
              />
              <Path
                path={mode === 'quad' ? quadPath : lassoPath}
                style="stroke"
                strokeWidth={2}
                color={Colors.white}
                strokeJoin="round"
                strokeCap="round"
              />
              <Path
                path={smartPath}
                style="stroke"
                strokeWidth={4}
                color={smartBrush === 'add' ? Colors.accent : Colors.danger}
                strokeJoin="round"
                strokeCap="round"
              />
              {mode === 'quad' ? (
                <>
                  <Path path={quadHandles} style="fill" color={Colors.paper} />
                  <Path
                    path={quadHandles}
                    style="stroke"
                    strokeWidth={2.5}
                    color={Colors.accent}
                  />
                  <Group opacity={loupeOpacity}>
                    <Group clip={loupeClip}>
                      <Group transform={loupeTransform}>
                        <SkiaImage
                          image={image}
                          x={fit.x}
                          y={fit.y}
                          width={fit.width}
                          height={fit.height}
                          fit="contain"
                        />
                        <Path
                          path={quadPath}
                          style="stroke"
                          strokeWidth={1.5}
                          color={Colors.white}
                          strokeJoin="round"
                        />
                        <Path
                          path={quadHandles}
                          style="fill"
                          color={Colors.accent}
                        />
                      </Group>
                    </Group>
                    <Path
                      path={loupeClip}
                      style="stroke"
                      strokeWidth={3}
                      color={Colors.paper}
                    />
                    <Path
                      path={loupeClip}
                      style="stroke"
                      strokeWidth={1}
                      color={Colors.accent}
                    />
                  </Group>
                </>
              ) : null}
            </Canvas>
          ) : (
            <View style={styles.loading}>
              {imageError ? (
                <>
                  <Text style={styles.loadingTitle}>Fotoğraf açılamadı</Text>
                  <Text style={styles.loadingText}>{imageError}</Text>
                  {__DEV__ ? (
                    <Text style={styles.loadingDebug} selectable>
                      {imageUri}
                    </Text>
                  ) : null}
                </>
              ) : (
                <>
                  <ActivityIndicator color={Colors.paper} />
                  <Text style={styles.loadingText}>Fotoğraf hazırlanıyor…</Text>
                </>
              )}
            </View>
          )}

          <View style={styles.stageBadge}>
            {mode === 'lasso' ? (
              <Pencil size={13} color={Colors.paper} strokeWidth={2} />
            ) : mode === 'quad' ? (
              <Crop size={13} color={Colors.paper} strokeWidth={2} />
            ) : (
              <Wand2 size={13} color={Colors.paper} strokeWidth={2} />
            )}
            <Text style={styles.stageBadgeText}>
              {mode === 'lasso'
                ? 'SERBEST ÇİZİM'
                : mode === 'quad'
                  ? 'ÇOKGEN'
                  : 'AKILLI SEÇİM'}
            </Text>
          </View>

          {busy ? (
            <View style={styles.busyOverlay}>
              <View style={styles.busyCard}>
                <ActivityIndicator color={Colors.accent} />
                <Text style={styles.busyText}>{status ?? 'İşleniyor…'}</Text>
              </View>
            </View>
          ) : null}
        </View>
      </GestureDetector>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.three }]}>
        <View style={styles.segment}>
          <ModeTab
            active={mode === 'lasso'}
            label="Serbest"
            icon={<Pencil size={15} color={mode === 'lasso' ? Colors.ink : Colors.inkSoft} />}
            onPress={() => handleModeChange('lasso')}
          />
          <ModeTab
            active={mode === 'quad'}
            label="Dörtgen"
            icon={<Crop size={15} color={mode === 'quad' ? Colors.ink : Colors.inkSoft} />}
            onPress={() => handleModeChange('quad')}
          />
          <ModeTab
            active={mode === 'ai'}
            label="Akıllı"
            icon={<Wand2 size={15} color={mode === 'ai' ? Colors.ink : Colors.inkSoft} />}
            onPress={() => handleModeChange('ai')}
          />
        </View>

        <Text style={styles.instruction}>{instruction}</Text>

        {mode === 'ai' ? (
          <Text style={styles.engine} numberOfLines={2}>
            {smartPreparing
              ? 'Akıllı model hazırlanıyor…'
              : smartEngine === 'model'
                ? `MagicTouch modeli · çevrimdışı${smartNote ? ` · ${smartNote}` : ''}`
                : smartEngine === 'fallback'
                  ? `Yedek algoritma${smartNote ? ` · ${smartNote}` : ''}`
                  : 'Dokunmaya hazır'}
          </Text>
        ) : null}

        {status && !busy ? <Text style={styles.status}>{status}</Text> : null}

        {allowDirectSave ? (
          <View style={styles.directSave}>
            <ActionButton
              label="Kırpmadan kaydet"
              variant="secondary"
              icon={<Sparkles size={18} color={Colors.ink} strokeWidth={2} />}
              onPress={handleDirectExtract}
              disabled={!canExtract}
              accessibilityHint={directSaveHint}
            />
            <Text style={styles.directSaveHint}>{directSaveHint}</Text>
          </View>
        ) : null}

        {mode === 'ai' ? (
          <View style={styles.aiActions}>
            <View style={styles.brushRow}>
              <BrushTab
                active={smartBrush === 'add'}
                label="Ekle"
                icon={<Plus size={14} color={smartBrush === 'add' ? Colors.white : Colors.paper} />}
                onPress={() => setSmartBrush('add')}
              />
              <BrushTab
                active={smartBrush === 'remove'}
                label="Çıkar"
                icon={<Eraser size={14} color={smartBrush === 'remove' ? Colors.white : Colors.paper} />}
                onPress={() => setSmartBrush('remove')}
                disabled={smartCounts.positive === 0}
              />
              <View style={styles.brushSpacer} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Akıllı seçimi temizle"
                disabled={busy || (smartCounts.positive === 0 && smartCounts.negative === 0)}
                onPress={handleSmartReset}
                style={({ pressed }) => [
                  styles.resetButton,
                  pressed && styles.pressed,
                  (busy || (smartCounts.positive === 0 && smartCounts.negative === 0)) &&
                    styles.resetDisabled,
                ]}>
                <RotateCcw size={18} color={Colors.paper} strokeWidth={2} />
              </Pressable>
            </View>
            <ActionButton
              label={smartPreview ? 'Sticker yap' : 'Nesneye dokun'}
              icon={<Scissors size={18} color={Colors.white} strokeWidth={2} />}
              onPress={handleSmartConfirm}
              disabled={!smartPreview || busy}
            />
          </View>
        ) : (
          <View style={styles.actionsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Seçimi temizle"
              disabled={!hasActiveSelection || busy}
              onPress={handleReset}
              style={({ pressed }) => [
                styles.resetButton,
                pressed && styles.pressed,
                (!hasActiveSelection || busy) && styles.resetDisabled,
              ]}>
              <RotateCcw size={18} color={Colors.paper} strokeWidth={2} />
            </Pressable>
            <ActionButton
              label="Sticker yap"
              icon={<Scissors size={18} color={Colors.white} strokeWidth={2} />}
              onPress={handleManualExtract}
              disabled={!canExtract}
              style={styles.primaryAction}
            />
          </View>
        )}
      </View>

      <Modal
        visible={Boolean(draft)}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={handleDiscard}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.four }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleBlock}>
                <Text style={styles.sheetTitle}>Sticker hazır</Text>
                <Text style={styles.sheetSubtitle}>
                  Şeffaf PNG, beyaz kontur dosyaya işlendi.
                </Text>
              </View>
              <View style={styles.checkBadge}>
                <Check size={16} color={Colors.white} strokeWidth={3} />
              </View>
            </View>

            {draft ? <TransparencyPreview uri={draft.uri} height={210} /> : null}

            {draft ? (
              <Text style={styles.meta}>
                {draft.width} × {draft.height} px · Şeffaf PNG
              </Text>
            ) : null}

            <ActionButton
              label="Sticker'ı kaydet"
              loading={saving}
              onPress={handleSave}
              style={styles.sheetPrimary}
            />
            <ActionButton
              label="Vazgeç"
              variant="ghost"
              disabled={saving}
              onPress={handleDiscard}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ModeTab({
  active,
  label,
  icon,
  onPress,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.segmentTab, active && styles.segmentTabActive]}>
      {icon}
      <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function BrushTab({
  active,
  label,
  icon,
  onPress,
  disabled = false,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.brushTab,
        active && styles.brushTabActive,
        disabled && styles.resetDisabled,
      ]}>
      {icon}
      <Text style={[styles.brushLabel, active && styles.brushLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stage,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(248, 241, 226, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248, 241, 226, 0.08)',
  },
  pressed: {
    opacity: 0.7,
  },
  headerText: {
    flex: 1,
  },
  eyebrow: {
    fontFamily: Fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 2.2,
    color: 'rgba(248, 241, 226, 0.55)',
    marginBottom: 3,
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 24,
    color: Colors.paper,
    letterSpacing: -0.3,
  },
  stepChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(248, 241, 226, 0.1)',
  },
  stepText: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: 'rgba(248, 241, 226, 0.7)',
  },
  stage: {
    flex: 1,
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.three,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: '#0C0906',
  },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  loadingTitle: {
    fontFamily: Fonts.serif,
    fontSize: 24,
    color: Colors.paper,
    textAlign: 'center',
  },
  loadingText: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    color: 'rgba(248, 241, 226, 0.7)',
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
  },
  loadingDebug: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    lineHeight: 13,
    color: 'rgba(248, 241, 226, 0.4)',
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
  },
  stageBadge: {
    position: 'absolute',
    top: Spacing.three,
    left: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(12, 9, 6, 0.62)',
    borderWidth: 1,
    borderColor: 'rgba(248, 241, 226, 0.16)',
  },
  stageBadgeText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.4,
    color: 'rgba(248, 241, 226, 0.85)',
  },
  busyOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8, 5, 3, 0.58)',
  },
  busyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.four,
    borderRadius: Radius.md,
    backgroundColor: Colors.card,
  },
  busyText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 14,
    color: Colors.ink,
  },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    backgroundColor: Colors.stageSoft,
    gap: Spacing.three,
  },
  segment: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(248, 241, 226, 0.08)',
    gap: 4,
  },
  segmentTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 9,
    borderRadius: Radius.pill,
  },
  segmentTabActive: {
    backgroundColor: Colors.paper,
  },
  segmentLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    color: Colors.inkSoft,
  },
  segmentLabelActive: {
    color: Colors.ink,
  },
  aiActions: {
    gap: Spacing.three,
  },
  brushRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  engine: {
    fontFamily: Fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.2,
    color: 'rgba(248, 241, 226, 0.5)',
  },
  brushTab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(248, 241, 226, 0.22)',
  },
  brushTabActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  brushLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    color: Colors.paper,
  },
  brushLabelActive: {
    color: Colors.white,
  },
  brushSpacer: {
    flex: 1,
  },
  instruction: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(248, 241, 226, 0.72)',
  },
  status: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.accentSoft,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  directSave: {
    gap: Spacing.one,
  },
  directSaveHint: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    lineHeight: 16,
    color: 'rgba(248, 241, 226, 0.6)',
  },
  resetButton: {
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(248, 241, 226, 0.24)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetDisabled: {
    opacity: 0.35,
  },
  primaryAction: {
    flex: 1,
  },
  aiHint: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(248, 241, 226, 0.18)',
    backgroundColor: 'rgba(248, 241, 226, 0.06)',
  },
  aiHintIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(223, 95, 55, 0.18)',
  },
  aiHintTextBlock: {
    flex: 1,
    gap: 2,
  },
  aiHintTitle: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    color: Colors.paper,
  },
  aiHintBody: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: 'rgba(248, 241, 226, 0.55)',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: Colors.overlay,
  },
  sheet: {
    backgroundColor: Colors.paper,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.five,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.paperLine,
    marginBottom: Spacing.two,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  sheetTitleBlock: {
    flex: 1,
    gap: 2,
  },
  sheetTitle: {
    fontFamily: Fonts.serif,
    fontSize: 26,
    color: Colors.ink,
  },
  sheetSubtitle: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.inkSoft,
  },
  checkBadge: {
    width: 30,
    height: 30,
    borderRadius: Radius.pill,
    backgroundColor: Colors.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: Colors.inkFaint,
    textAlign: 'center',
  },
  sheetPrimary: {
    marginTop: Spacing.one,
  },
});
