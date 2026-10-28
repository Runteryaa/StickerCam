import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';

import { preparePhoto } from '@/services/imageService';
import { setPendingPhoto } from '@/services/photoSession';
import { withTimeout } from '@/utils/withTimeout';

/**
 * Galeriden fotoğraf seçip editöre yönlendirir.
 */
export function usePhotoPicker() {
  const [picking, setPicking] = useState(false);

  const pickPhoto = useCallback(async () => {
    if (picking) {
      return;
    }
    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsMultipleSelection: false,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const prepared = await withTimeout(
        preparePhoto(asset.uri),
        15_000,
        'Fotoğraf işlenmesi zaman aşımına uğradı. Lütfen tekrar dene.',
      );
      setPendingPhoto({ uri: prepared.uri, source: 'library' });
      router.push('/editor');
    } catch (error) {
      Alert.alert(
        'Fotoğraf açılamadı',
        error instanceof Error && error.message
          ? error.message
          : 'Seçilen fotoğraf işlenemedi. Başka bir fotoğraf deneyebilirsin.',
      );
    } finally {
      setPicking(false);
    }
  }, [picking]);

  return { pickPhoto, picking };
}
