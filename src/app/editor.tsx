import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ActionButton';
import { ObjectCutter } from '@/components/ObjectCutter';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import {
  clearPendingPhoto,
  getEditorOriginPage,
  getPendingPhoto,
  subscribePendingPhoto,
} from '@/services/photoSession';

export default function EditorScreen() {
  // Route parametresi kullanmıyoruz: dosya URI'si yönlendirme sırasında
  // URL-decode edilerek bozuluyordu.
  const [pending, setPending] = useState(getPendingPhoto);

  // Editör açıkken yeni bir görsel paylaşılırsa içerik tazelenir; ekranda
  // kalıp eski fotoğrafı göstermeye devam etmeyiz.
  useEffect(
    () =>
      subscribePendingPhoto((photo) => {
        setPending(photo);
      }),
    [],
  );

  const uri = pending?.uri;
  const source = pending?.source ?? 'camera';
  const hasAlpha = pending?.hasAlpha ?? false;

  if (!uri) {
    return (
      <View style={styles.missing}>
        <StatusBar style="light" />
        <Text style={styles.missingTitle}>Fotoğraf bulunamadı</Text>
        <Text style={styles.missingBody}>
          Görsel yüklenemedi. Geri dönüp yeni bir fotoğraf seçebilirsin.
        </Text>
        <ActionButton label="Geri dön" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <ObjectCutter
        key={uri}
        imageUri={uri}
        source={source}
        hasAlpha={hasAlpha}
        onClose={() => {
          clearPendingPhoto();
          router.back();
        }}
        onSaved={() => {
          clearPendingPhoto();
          // Kullanıcı bir sayfa ekranından geldiyse oraya, aksi halde deftere dön.
          const originPageId = getEditorOriginPage();
          if (originPageId) {
            router.dismissTo({ pathname: '/page/[id]', params: { id: originPageId } });
            return;
          }
          router.dismissTo('/');
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.six,
    backgroundColor: Colors.stage,
  },
  missingTitle: {
    fontFamily: Fonts.serif,
    fontSize: 28,
    color: Colors.paper,
  },
  missingBody: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: 'rgba(248, 241, 226, 0.65)',
    textAlign: 'center',
  },
});
