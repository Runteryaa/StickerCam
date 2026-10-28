import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { Camera, Images, Layers, Sparkles, Trash2, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/ActionButton';
import { TransparencyPreview } from '@/components/TransparencyPreview';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { usePhotoPicker } from '@/hooks/usePhotoPicker';
import {
  deleteSticker,
  listStickers,
  type StickerRecord,
} from '@/services/stickerService';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [stickers, setStickers] = useState<StickerRecord[]>([]);
  const [preview, setPreview] = useState<StickerRecord | null>(null);
  const { pickPhoto, picking } = usePhotoPicker();

  const refresh = useCallback(() => {
    try {
      setStickers(listStickers());
    } catch {
      setStickers([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const confirmDelete = useCallback(
    (sticker: StickerRecord) => {
      Alert.alert(
        'Sticker silinsin mi?',
        'Bu kesim cihazdan kaldırılacak. Bu işlem geri alınamaz.',
        [
          { text: 'Vazgeç', style: 'cancel' },
          {
            text: 'Sil',
            style: 'destructive',
            onPress: () => {
              deleteSticker(sticker.id);
              refresh();
            },
          },
        ],
      );
    },
    [refresh],
  );

  const openCamera = useCallback(() => {
    router.push('/camera');
  }, []);

  const header = (
    <View style={styles.header}>
      <View style={styles.topRow}>
        <Text style={styles.eyebrow}>STICKER SCRAPBOOK</Text>
        <View style={styles.countChip}>
          <Layers size={12} color={Colors.inkSoft} strokeWidth={2} />
          <Text style={styles.countText}>
            {stickers.length} sticker
          </Text>
        </View>
      </View>

      <Text style={styles.title}>
        Kes, biriktir,{'\n'}sayfalara yapıştır.
      </Text>
      <Text style={styles.subtitle}>
        Bir kare yakala, istediğin nesnenin etrafını çiz. StickerCam gerisini şeffaf
        bir sticker’a dönüştürsün.
      </Text>

      <View style={styles.actions}>
        <ActionButton
          label="Fotoğraf çek"
          icon={<Camera size={19} color={Colors.white} strokeWidth={2} />}
          onPress={openCamera}
          accessibilityHint="Kamerayı açar ve yeni bir sticker için fotoğraf çekmenizi sağlar"
        />
        <ActionButton
          label={picking ? 'Galeri açılıyor…' : 'Galeriden seç'}
          variant="secondary"
          loading={picking}
          icon={<Images size={19} color={Colors.ink} strokeWidth={2} />}
          onPress={pickPhoto}
        />
      </View>

      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Sticker’ların</Text>
          <Text style={styles.sectionSubtitle}>
            Henüz sayfalara yerleşmedi; kesimler burada birikiyor.
          </Text>
        </View>
        <View style={styles.sectionMark} />
      </View>
    </View>
  );

  const emptyState = (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIcon}>
        <Sparkles size={22} color={Colors.accent} strokeWidth={2} />
      </View>
      <Text style={styles.emptyTitle}>İlk sticker’ını yap</Text>
      <Text style={styles.emptyBody}>
        Kamerayla bir fotoğraf çek ya da galeriden bir kare seç. Nesnenin çevresini
        çizdiğinde geriye yalnızca o nesne kalacak.
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <FlatList
        data={stickers}
        keyExtractor={(item) => item.id}
        numColumns={2}
        renderItem={({ item, index }) => (
          <StickerCard
            sticker={item}
            index={index}
            onOpen={() => setPreview(item)}
            onDelete={() => confirmDelete(item)}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={emptyState}
        columnWrapperStyle={stickers.length > 0 ? styles.columns : undefined}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Spacing.six },
        ]}
        showsVerticalScrollIndicator={false}
      />

      <Modal
        visible={Boolean(preview)}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setPreview(null)}>
        <View style={styles.previewBackdrop}>
          <View style={[styles.previewCard, { marginBottom: insets.bottom + Spacing.four }]}>
            <View style={styles.previewHeader}>
              <View>
                <Text style={styles.previewEyebrow}>ŞEFFAF PNG</Text>
                <Text style={styles.previewTitle}>Sticker önizleme</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Önizlemeyi kapat"
                onPress={() => setPreview(null)}
                style={styles.previewClose}>
                <X size={18} color={Colors.inkSoft} strokeWidth={2} />
              </Pressable>
            </View>

            {preview ? <TransparencyPreview uri={preview.uri} height={280} /> : null}

            {preview ? (
              <Text style={styles.previewMeta}>
                {preview.width} × {preview.height} px · Şeffaf PNG
              </Text>
            ) : null}

            <ActionButton
              label="Sticker'ı sil"
              variant="danger"
              icon={<Trash2 size={17} color={Colors.danger} strokeWidth={2} />}
              onPress={() => {
                const current = preview;
                setPreview(null);
                if (current) {
                  confirmDelete(current);
                }
              }}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function StickerCard({
  sticker,
  index,
  onOpen,
  onDelete,
}: {
  sticker: StickerRecord;
  index: number;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const rotation = index % 2 === 0 ? '-1.1deg' : '1.1deg';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Sticker önizlemesini aç"
      onPress={onOpen}
      onLongPress={onDelete}
      delayLongPress={280}
      style={({ pressed }) => [
        styles.card,
        { transform: [{ rotate: rotation }] },
        pressed && styles.cardPressed,
      ]}>
      <View style={styles.cardImageWrap}>
        <Image
          source={{ uri: sticker.uri }}
          style={styles.cardImage}
          contentFit="contain"
          transition={120}
        />
      </View>
      <View style={styles.cardFooter}>
        <Text style={styles.cardMeta}>
          {sticker.width}×{sticker.height}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sticker'ı sil"
          hitSlop={10}
          onPress={onDelete}
          style={styles.cardDelete}>
          <Trash2 size={13} color={Colors.inkFaint} strokeWidth={2} />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.paper,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
  header: {
    gap: Spacing.three,
    paddingBottom: Spacing.two,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  eyebrow: {
    fontFamily: Fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 2.4,
    color: Colors.inkFaint,
  },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.paperDeep,
  },
  countText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 11,
    color: Colors.inkSoft,
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 38,
    lineHeight: 43,
    letterSpacing: -0.8,
    color: Colors.ink,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: Colors.inkSoft,
    maxWidth: 340,
  },
  actions: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: Spacing.four,
    gap: Spacing.three,
  },
  sectionTitle: {
    fontFamily: Fonts.serif,
    fontSize: 23,
    color: Colors.ink,
  },
  sectionSubtitle: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.inkFaint,
    marginTop: 2,
  },
  sectionMark: {
    width: 26,
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.accent,
    marginBottom: 6,
  },
  columns: {
    gap: Spacing.three,
  },
  card: {
    flex: 1,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.paperLine,
    borderRadius: Radius.md,
    padding: Spacing.two,
    shadowColor: Colors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  cardPressed: {
    opacity: 0.82,
  },
  cardImageWrap: {
    aspectRatio: 1,
    borderRadius: Radius.sm,
    backgroundColor: Colors.paperDeep,
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingTop: 6,
    paddingBottom: 2,
  },
  cardMeta: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: Colors.inkFaint,
  },
  cardDelete: {
    padding: 2,
  },
  emptyCard: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.paperLine,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.six,
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: 'rgba(255, 251, 242, 0.55)',
  },
  emptyIcon: {
    width: 46,
    height: 46,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accentSoft,
  },
  emptyTitle: {
    fontFamily: Fonts.serif,
    fontSize: 21,
    color: Colors.ink,
  },
  emptyBody: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    color: Colors.inkSoft,
    textAlign: 'center',
  },
  previewBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: Colors.overlay,
    paddingHorizontal: Spacing.four,
  },
  previewCard: {
    backgroundColor: Colors.paper,
    borderRadius: Radius.lg,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewEyebrow: {
    fontFamily: Fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 2,
    color: Colors.inkFaint,
  },
  previewTitle: {
    fontFamily: Fonts.serif,
    fontSize: 24,
    color: Colors.ink,
    marginTop: 2,
  },
  previewClose: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.paperDeep,
  },
  previewMeta: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.inkFaint,
    textAlign: 'center',
  },
});
