import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Camera as CameraIcon,
  Images,
  Pencil,
  Plus,
  Send,
  Share2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react-native';
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
import { NameDialog } from '@/components/NameDialog';
import { TransparencyPreview } from '@/components/TransparencyPreview';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { usePhotoPicker } from '@/hooks/usePhotoPicker';
import { setEditorOriginPage } from '@/services/photoSession';
import { shareStickerImage } from '@/services/shareService';
import {
  deletePage,
  deleteSticker,
  getPage,
  loadLibrary,
  renamePage,
  setActivePageId,
  type ScrapbookPage,
  type StickerRecord,
} from '@/services/stickerService';

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Beklenmeyen bir hata oluştu.';
}

export default function PageScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const pageId = typeof params.id === 'string' ? params.id : '';
  const { pickPhoto, picking } = usePhotoPicker();

  const [page, setPage] = useState<ScrapbookPage | null>(null);
  const [stickers, setStickers] = useState<StickerRecord[]>([]);
  const [preview, setPreview] = useState<StickerRecord | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [missing, setMissing] = useState(false);

  const refresh = useCallback(() => {
    const entry = getPage(pageId);
    if (!entry) {
      setMissing(true);
      setPage(null);
      setStickers([]);
      return;
    }
    setMissing(false);
    setPage(entry.page);
    setStickers(entry.stickers);
  }, [pageId]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      // Bu sayfa açıkken yapılan kayıtlar buraya eklensin.
      if (pageId) {
        setActivePageId(pageId);
      }
    }, [pageId, refresh]),
  );

  const openCamera = useCallback(() => {
    setEditorOriginPage(pageId || null);
    router.push('/camera');
  }, [pageId]);

  const pickFromLibrary = useCallback(() => {
    setEditorOriginPage(pageId || null);
    pickPhoto();
  }, [pageId, pickPhoto]);

  const confirmDeleteSticker = useCallback(
    (sticker: StickerRecord) => {
      Alert.alert(
        'Sticker silinsin mi?',
        'Bu kesim cihazdan tamamen kaldırılacak. Bu işlem geri alınamaz.',
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

  const sharePreview = useCallback(async () => {
    if (!preview) {
      return;
    }
    try {
      await shareStickerImage(preview.uri);
    } catch (error) {
      Alert.alert('Paylaşılamadı', errorMessage(error));
    }
  }, [preview]);

  const confirmDeletePage = useCallback(() => {
    if (!page) {
      return;
    }
    const isLastPage = loadLibrary().length <= 1;
    const message = isLastPage
      ? stickers.length > 0
        ? `“${page.name}” son sayfan. Silersen içindeki ${stickers.length} sticker da cihazdan kaldırılacak.`
        : `“${page.name}” son sayfan ve silinecek.`
      : stickers.length > 0
        ? `“${page.name}” sayfası silinecek. İçindeki ${stickers.length} sticker başka bir sayfaya taşınacak.`
        : `“${page.name}” sayfası silinecek.`;

    Alert.alert('Sayfa silinsin mi?', message, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: isLastPage && stickers.length > 0 ? 'Sayfayı ve sticker’ları sil' : 'Sil',
        style: 'destructive',
        onPress: () => {
          const result = deletePage(page.id);
          if (result.deletedStickers > 0) {
            Alert.alert(
              'Sayfa silindi',
              `Başka sayfa olmadığı için ${result.deletedStickers} sticker da silindi.`,
            );
          }
          router.back();
        },
      },
    ]);
  }, [page, stickers.length]);

  const submitRename = useCallback(
    (value: string) => {
      if (!page) {
        return;
      }
      renamePage(page.id, value);
      setRenaming(false);
      refresh();
    },
    [page, refresh],
  );

  if (missing) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.missingWrap}>
          <Text style={styles.missingTitle}>Sayfa bulunamadı</Text>
          <Text style={styles.missingBody}>
            Bu sayfa silinmiş olabilir. Deftere dönüp başka bir sayfa açabilirsin.
          </Text>
          <ActionButton label="Deftere dön" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Deftere dön"
          hitSlop={10}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          <ArrowLeft size={19} color={Colors.ink} strokeWidth={2} />
        </Pressable>

        <View style={styles.headerCenter}>
          <Text style={styles.eyebrow}>SAYFA</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sayfayı yeniden adlandır"
            onPress={() => setRenaming(true)}
            style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {page?.name ?? 'Sayfa'}
            </Text>
            <Pencil size={13} color={Colors.inkFaint} strokeWidth={2} />
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sayfayı sil"
          hitSlop={10}
          onPress={confirmDeletePage}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          <Trash2 size={17} color={Colors.inkSoft} strokeWidth={2} />
        </Pressable>
      </View>

      <View style={styles.countRow}>
        <View style={styles.countChip}>
          <Sparkles size={12} color={Colors.accent} strokeWidth={2} />
          <Text style={styles.countText}>{stickers.length} sticker</Text>
        </View>
        <Text style={styles.countHint}>Yeni kesimler bu sayfaya eklenir.</Text>
      </View>
    </View>
  );

  const emptyState = (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIcon}>
        <Plus size={20} color={Colors.accent} strokeWidth={2} />
      </View>
      <Text style={styles.emptyTitle}>Sayfa boş</Text>
      <Text style={styles.emptyBody}>
        Fotoğraf çek ya da galeriden seç; kesilen sticker bu sayfaya yapıştırılacak.
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
            onDelete={() => confirmDeleteSticker(item)}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={emptyState}
        columnWrapperStyle={stickers.length > 0 ? styles.columns : undefined}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 132 },
        ]}
        showsVerticalScrollIndicator={false}
      />

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.three }]}>
        <ActionButton
          label="Fotoğraf çek"
          icon={<CameraIcon size={18} color={Colors.white} strokeWidth={2} />}
          onPress={openCamera}
          compact
        />
        <ActionButton
          label={picking ? 'Açılıyor…' : 'Galeriden seç'}
          variant="secondary"
          loading={picking}
          icon={<Images size={18} color={Colors.ink} strokeWidth={2} />}
          onPress={pickFromLibrary}
          compact
        />
      </View>

      <NameDialog
        visible={renaming}
        title="Sayfayı adlandır"
        description="Bu ad defterde ve dışa aktarmada görünür."
        initialValue={page?.name ?? ''}
        confirmLabel="Kaydet"
        onCancel={() => setRenaming(false)}
        onSubmit={submitRename}
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

            {preview ? <TransparencyPreview uri={preview.uri} height={260} /> : null}

            {preview ? (
              <Text style={styles.previewMeta}>
                {preview.width} × {preview.height} px · Şeffaf PNG
              </Text>
            ) : null}

            <ActionButton
              label="Paylaş"
              variant="secondary"
              icon={<Share2 size={17} color={Colors.ink} strokeWidth={2} />}
              onPress={sharePreview}
            />
            <ActionButton
              label="WhatsApp paketine ekle"
              variant="secondary"
              icon={<Send size={17} color={Colors.ink} strokeWidth={2} />}
              onPress={() => {
                setPreview(null);
                router.push('/export');
              }}
            />
            <ActionButton
              label="Sticker'ı sil"
              variant="danger"
              icon={<Trash2 size={17} color={Colors.danger} strokeWidth={2} />}
              onPress={() => {
                const current = preview;
                setPreview(null);
                if (current) {
                  confirmDeleteSticker(current);
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
  const rotation = index % 3 === 0 ? '-1.4deg' : index % 3 === 1 ? '1.2deg' : '-0.6deg';

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
        pressed && styles.pressed,
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
    paddingTop: Spacing.two,
    gap: Spacing.three,
  },
  header: {
    gap: Spacing.three,
    paddingBottom: Spacing.two,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.paperDeep,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  eyebrow: {
    fontFamily: Fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 2.2,
    color: Colors.inkFaint,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 24,
    color: Colors.ink,
    maxWidth: 220,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accentSoft,
  },
  countText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 11,
    color: Colors.accentDeep,
  },
  countHint: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: 11,
    color: Colors.inkFaint,
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
  pressed: {
    opacity: 0.8,
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
    width: 44,
    height: 44,
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
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: Colors.paperLine,
    backgroundColor: Colors.paper,
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
  missingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.six,
  },
  missingTitle: {
    fontFamily: Fonts.serif,
    fontSize: 25,
    color: Colors.ink,
  },
  missingBody: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    color: Colors.inkSoft,
    textAlign: 'center',
  },
});
