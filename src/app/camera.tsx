import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Flashlight, FlashlightOff, Images, SwitchCamera, X } from 'lucide-react-native';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/ActionButton';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { usePhotoPicker } from '@/hooks/usePhotoPicker';
import { preparePhoto, type PreparedPhoto } from '@/services/imageService';
import { setPendingPhoto } from '@/services/photoSession';
import { withTimeout } from '@/utils/withTimeout';

const CAPTURE_TIMEOUT_MS = 20_000;
const PREPARE_TIMEOUT_MS = 15_000;

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [torch, setTorch] = useState(false);
  const [focused, setFocused] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);

  const cameraRef = useRef<CameraView>(null);
  const { pickPhoto, picking } = usePhotoPicker();

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
        setReady(false);
      };
    }, []),
  );

  const handleCapture = useCallback(async () => {
    if (busy || !ready || !cameraRef.current) {
      return;
    }
    setBusy(true);
    try {
      console.log('[StickerCam] capture:start');
      const photo = await withTimeout(
        cameraRef.current.takePictureAsync({
          quality: 0.92,
          skipProcessing: false,
        }),
        CAPTURE_TIMEOUT_MS,
        'Fotoğraf çekimi zaman aşımına uğradı. Lütfen tekrar dene.',
      );
      if (!photo?.uri) {
        throw new Error('Fotoğraf kaydedilemedi.');
      }
      console.log('[StickerCam] capture:done', photo.uri, photo.width, photo.height);

      let prepared: PreparedPhoto;
      try {
        prepared = await withTimeout(
          preparePhoto(photo.uri),
          PREPARE_TIMEOUT_MS,
          'Fotoğraf işlenmesi zaman aşımına uğradı.',
        );
        console.log('[StickerCam] prepare:done', prepared.uri, prepared.width, prepared.height);
      } catch (error) {
        // Görsel işleme takılırsa ham fotoğrafla devam et; editör kendi
        // görsel yükleyicisiyle açabildiği kadarını gösterecek.
        console.warn('[StickerCam] prepare:fallback', error);
        prepared = {
          uri: photo.uri,
          width: photo.width,
          height: photo.height,
        };
      }

      setPendingPhoto({ uri: prepared.uri, source: 'camera' });
      router.push('/editor');
    } catch (error) {
      Alert.alert(
        'Fotoğraf çekilemedi',
        error instanceof Error && error.message
          ? error.message
          : 'Kamera şu anda kullanılamıyor. Tekrar deneyebilirsin.',
      );
    } finally {
      setBusy(false);
    }
  }, [busy, ready]);

  const toggleFacing = useCallback(() => {
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
    setTorch(false);
  }, []);

  const isGranted = permission?.granted === true;

  if (!permission) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={Colors.accent} />
        <Text style={styles.loadingText}>Kamera hazırlanıyor…</Text>
      </View>
    );
  }

  if (!isGranted) {
    return (
      <View style={styles.permissionScreen}>
        <StatusBar style="dark" />
        <View style={[styles.permissionContent, { paddingTop: insets.top + Spacing.six }]}>
          <View style={styles.permissionIcon}>
            <Flashlight size={26} color={Colors.accent} strokeWidth={2} />
          </View>
          <Text style={styles.permissionEyebrow}>KAMERA İZNİ</Text>
          <Text style={styles.permissionTitle}>Nesneleri yakalamak için kameraya ihtiyacımız var.</Text>
          <Text style={styles.permissionBody}>
            Kamera yalnızca fotoğraf çekmek için kullanılır; görüntüler cihazından
            ayrılmaz. İzin vermek istemezsen galeriden de bir fotoğraf seçebilirsin.
          </Text>

          <View style={styles.permissionActions}>
            {permission.canAskAgain ? (
              <ActionButton label="Kameraya izin ver" onPress={requestPermission} />
            ) : (
              <ActionButton label="Ayarları aç" onPress={() => void Linking.openSettings()} />
            )}
            <ActionButton
              label="Galeriden seç"
              variant="secondary"
              loading={picking}
              onPress={pickPhoto}
            />
            <ActionButton
              label="Geri dön"
              variant="ghost"
              onPress={() => router.back()}
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {focused ? (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mode="picture"
          flash="off"
          enableTorch={torch}
          onCameraReady={() => {
            setReady(true);
            setMountError(null);
          }}
          onMountError={(event) => {
            setMountError(event.message);
          }}
        />
      ) : (
        <View style={styles.cameraPlaceholder} />
      )}

      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.two }]}>
        <RoundIconButton label="Kamerayı kapat" onPress={() => router.back()}>
          <X size={20} color={Colors.white} strokeWidth={2} />
        </RoundIconButton>

        <View style={styles.topBarSpacer} />

        <RoundIconButton
          label={torch ? 'Işığı kapat' : 'Işığı aç'}
          active={torch}
          onPress={() => setTorch((value) => !value)}>
          {torch ? (
            <Flashlight size={19} color={Colors.ink} strokeWidth={2} />
          ) : (
            <FlashlightOff size={19} color={Colors.white} strokeWidth={2} />
          )}
        </RoundIconButton>
        <RoundIconButton label="Kamerayı çevir" onPress={toggleFacing}>
          <SwitchCamera size={20} color={Colors.white} strokeWidth={2} />
        </RoundIconButton>
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.four }]}>
        {mountError ? (
          <View style={styles.errorPill}>
            <Text style={styles.errorText}>{mountError}</Text>
          </View>
        ) : (
          <View style={styles.hintPill}>
            <Text style={styles.hintText}>
              {busy ? 'Fotoğraf hazırlanıyor…' : 'Nesneyi kadraja al, sonra etrafını çiz.'}
            </Text>
          </View>
        )}

        <View style={styles.controlsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Galeriden fotoğraf seç"
            disabled={picking || busy}
            onPress={pickPhoto}
            style={({ pressed }) => [
              styles.galleryButton,
              (picking || busy) && styles.controlDisabled,
              pressed && styles.controlPressed,
            ]}>
            {picking ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Images size={22} color={Colors.white} strokeWidth={2} />
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fotoğraf çek"
            accessibilityState={{ disabled: !ready || busy, busy }}
            disabled={!ready || busy}
            onPress={handleCapture}
            style={({ pressed }) => [
              styles.shutter,
              (!ready || busy) && styles.controlDisabled,
              pressed && styles.controlPressed,
            ]}>
            <View style={styles.shutterInner} />
            {busy ? (
              <View style={styles.shutterBusy}>
                <ActivityIndicator color={Colors.ink} />
              </View>
            ) : null}
          </Pressable>

          <View style={styles.gallerySpacer}>
            <Text style={styles.readyLabel}>
              {ready ? 'HAZIR' : 'BEKLE'}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function RoundIconButton({
  children,
  label,
  onPress,
  active = false,
}: {
  children: ReactNode;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.roundButton,
        active && styles.roundButtonActive,
        pressed && styles.controlPressed,
      ]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stage,
  },
  cameraPlaceholder: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Colors.stage,
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    backgroundColor: Colors.paper,
  },
  loadingText: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    color: Colors.inkSoft,
  },
  permissionScreen: {
    flex: 1,
    backgroundColor: Colors.paper,
  },
  permissionContent: {
    flex: 1,
    paddingHorizontal: Spacing.five,
    gap: Spacing.three,
  },
  permissionIcon: {
    width: 54,
    height: 54,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accentSoft,
    marginBottom: Spacing.two,
  },
  permissionEyebrow: {
    fontFamily: Fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 2.4,
    color: Colors.inkFaint,
  },
  permissionTitle: {
    fontFamily: Fonts.serif,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.5,
    color: Colors.ink,
  },
  permissionBody: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: Colors.inkSoft,
  },
  permissionActions: {
    marginTop: Spacing.four,
    gap: Spacing.two,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  topBarSpacer: {
    flex: 1,
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14, 10, 7, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  roundButtonActive: {
    backgroundColor: Colors.paper,
    borderColor: Colors.paper,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.five,
    gap: Spacing.four,
    backgroundColor: 'rgba(14, 10, 7, 0.4)',
    paddingTop: Spacing.four,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
  },
  hintPill: {
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(14, 10, 7, 0.45)',
  },
  hintText: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.82)',
  },
  errorPill: {
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(184, 66, 47, 0.75)',
  },
  errorText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 12,
    color: Colors.white,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  galleryButton: {
    width: 54,
    height: 54,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  shutter: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.85)',
  },
  shutterInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.white,
  },
  shutterBusy: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    borderRadius: 41,
  },
  gallerySpacer: {
    width: 54,
    alignItems: 'center',
  },
  readyLabel: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  controlDisabled: {
    opacity: 0.45,
  },
  controlPressed: {
    opacity: 0.75,
  },
});
