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
  type SkImage,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Check, Pencil, RotateCcw, Scissors, Wand2 } from 'lucide-react-native';

import { ActionButton } from '@/components/ActionButton';
import { TransparencyPreview } from '@/components/TransparencyPreview';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useSkiaImage } from '@/hooks/useSkiaImage';
import { isSmartSelectionAvailable, segmentImage } from '@/services/segmentationService';
import { loadSkiaImage } from '@/services/skiaImageLoader';
import {
  commitSticker,
  discardStaged,
  stageSticker,
  type StagedSticker,
  type StickerRecord,
  type StickerSource,
} from '@/services/stickerService';
import { containRect, viewPointToImage, type Point } from '@/utils/geometry';
import { buildLassoPath } from '@/utils/lasso';
import { cutOutWithPath, finalizeSticker } from '@/utils/stickerImage';

type SelectionMode = 'lasso' | 'ai';

type ObjectCutterProps = {
  imageUri: string;
  source?: StickerSource;
  onClose: () => void;
  onSaved: (sticker: StickerRecord) => void;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Beklenmeyen bir hata oluştu. Tekrar deneyebilirsin.';
}

export function ObjectCutter({
  imageUri,
  source = 'camera',
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
  const stagedRef = useRef<StagedSticker | null>(null);

  const imageSize = useMemo(
    () => ({ width: image?.width() ?? 0, height: image?.height() ?? 0 }),
    [image],
  );

  const fit = useMemo(
    () => containRect(imageSize.width, imageSize.height, stageSize.width, stageSize.height),
    [imageSize.height, imageSize.width, stageSize.height, stageSize.width],
  );

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

  const handleLassoExtract = useCallback(async () => {
    if (!image) {
      return;
    }
    const rawPoints = points.value;
    if (rawPoints.length < 3) {
      setStatus('Önce parmağınla nesnenin etrafını çiz.');
      return;
    }

    setBusy(true);
    setStatus('Nesne kesiliyor…');
    try {
      const imagePoints = rawPoints.map((point) =>
        viewPointToImage(point, fit, imageSize),
      );
      const path = buildLassoPath(imagePoints);
      const cutout = cutOutWithPath(image, path, imageSize);
      if (!cutout) {
        throw new Error('Seçim çok küçük görünüyor. Daha geniş bir alan çiz.');
      }
      openDraft(finalizeSticker(cutout), source);
      setStatus(null);
    } catch (error) {
      Alert.alert('Sticker oluşturulamadı', errorMessage(error));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [fit, image, imageSize, openDraft, points, source]);

  const handleSmartTap = useCallback(
    async (viewX: number, viewY: number) => {
      if (!image) {
        return;
      }
      const insidePhoto =
        viewX >= fit.x &&
        viewX <= fit.x + fit.width &&
        viewY >= fit.y &&
        viewY <= fit.y + fit.height;
      if (!insidePhoto) {
        setStatus('Kesmek istediğin nesnenin üzerine dokun.');
        return;
      }

      const point = viewPointToImage({ x: viewX, y: viewY }, fit, imageSize);
      setBusy(true);
      setStatus('Nesne otomatik seçiliyor…');
      try {
        const result = await segmentImage({ imageUri, image, point, imageSize });
        const cutout = await loadSkiaImage(result.uri);
        openDraft(finalizeSticker(cutout), 'ai');
        setStatus(null);
      } catch (error) {
        setStatus(errorMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [fit, image, imageSize, imageUri, openDraft],
  );

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

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .enabled(!busy)
        .maxDistance(14)
        .onEnd((event, success) => {
          if (success) {
            runOnJS(handleSmartTap)(event.x, event.y);
          }
        }),
    [busy, handleSmartTap],
  );

  const handleReset = useCallback(() => {
    points.value = [];
    setHasSelection(false);
    setIsDrawing(false);
    setStatus(null);
  }, [points]);

  const handleModeChange = useCallback(
    (next: SelectionMode) => {
      if (next === mode) {
        return;
      }
      setMode(next);
      setStatus(null);
      points.value = [];
      setHasSelection(false);
      setIsDrawing(false);
    },
    [mode, points],
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
      : smartSelectionReady
        ? 'Nesnenin üzerine tek dokunuş yap; benzer renkli bölge otomatik seçilsin.'
        : 'Akıllı kesim servisi bağlı değil. Çizim modunda etrafını çizebilirsin.';

  const canExtract = Boolean(image) && !busy;

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

      <GestureDetector gesture={mode === 'lasso' ? panGesture : tapGesture}>
        <View
          style={styles.stage}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setStageSize({ width, height });
          }}>
          {image ? (
            <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
              <SkiaImage
                image={image}
                x={fit.x}
                y={fit.y}
                width={fit.width}
                height={fit.height}
                fit="contain"
              />
              {isDrawing || hasSelection ? (
                <Group clip={lassoPath} invertClip>
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
                path={lassoPath}
                style="stroke"
                strokeWidth={6}
                color="rgba(223, 95, 55, 0.32)"
                strokeJoin="round"
                strokeCap="round"
              />
              <Path
                path={lassoPath}
                style="stroke"
                strokeWidth={2}
                color={Colors.white}
                strokeJoin="round"
                strokeCap="round"
              />
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
            ) : (
              <Wand2 size={13} color={Colors.paper} strokeWidth={2} />
            )}
            <Text style={styles.stageBadgeText}>
              {mode === 'lasso' ? 'SERBEST ÇİZİM' : 'AKILLI SEÇİM'}
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
            label="Serbest çizim"
            icon={<Pencil size={15} color={mode === 'lasso' ? Colors.ink : Colors.inkSoft} />}
            onPress={() => handleModeChange('lasso')}
          />
          <ModeTab
            active={mode === 'ai'}
            label="Akıllı seçim"
            icon={<Wand2 size={15} color={mode === 'ai' ? Colors.ink : Colors.inkSoft} />}
            onPress={() => handleModeChange('ai')}
          />
        </View>

        <Text style={styles.instruction}>{instruction}</Text>

        {status && !busy ? <Text style={styles.status}>{status}</Text> : null}

        <View style={styles.actionsRow}>
          {mode === 'lasso' ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Seçimi temizle"
                disabled={!hasSelection || busy}
                onPress={handleReset}
                style={({ pressed }) => [
                  styles.resetButton,
                  pressed && styles.pressed,
                  (!hasSelection || busy) && styles.resetDisabled,
                ]}>
                <RotateCcw size={18} color={Colors.paper} strokeWidth={2} />
              </Pressable>
              <ActionButton
                label="Sticker yap"
                icon={<Scissors size={18} color={Colors.white} strokeWidth={2} />}
                onPress={handleLassoExtract}
                disabled={!canExtract}
                style={styles.primaryAction}
              />
            </>
          ) : (
            <View style={styles.aiHint}>
              <View style={styles.aiHintIcon}>
                <Wand2 size={18} color={Colors.accentSoft} strokeWidth={2} />
              </View>
              <View style={styles.aiHintTextBlock}>
                <Text style={styles.aiHintTitle}>
                  {smartSelectionReady ? 'Nesneye dokun' : 'Servis bağlı değil'}
                </Text>
                <Text style={styles.aiHintBody}>
                  {smartSelectionReady
                    ? 'Tek dokunuşla benzer renkli bölge şeffaf PNG olarak kesilir.'
                    : 'Serbest çizim moduna dönerek nesnenin etrafını çizebilirsin.'}
                </Text>
              </View>
            </View>
          )}
        </View>
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
