import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import {
  Camera,
  Images,
  Pencil,
  Plus,
  Send,
  Sparkles,
} from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/ActionButton';
import { NameDialog } from '@/components/NameDialog';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { usePhotoPicker } from '@/hooks/usePhotoPicker';
import { setEditorOriginPage } from '@/services/photoSession';
import {
  createPage,
  deletePage,
  getActivePageId,
  loadLibrary,
  renamePage,
  setActivePageId,
  suggestPageName,
  type PageWithStickers,
} from '@/services/stickerService';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [library, setLibrary] = useState<PageWithStickers[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<PageWithStickers | null>(null);
  const { pickPhoto, picking } = usePhotoPicker();

  const refresh = useCallback(() => {
    try {
      const pages = loadLibrary();
      setLibrary(pages);
      setActiveId(getActivePageId());
    } catch {
      setLibrary([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const totalStickers = useMemo(
    () => library.reduce((sum, entry) => sum + entry.stickers.length, 0),
    [library],
  );

  const openCamera = useCallback(() => {
    setEditorOriginPage(null);
    router.push('/camera');
  }, []);

  const openPage = useCallback((pageId: string) => {
    setActivePageId(pageId);
    router.push({ pathname: '/page/[id]', params: { id: pageId } });
  }, []);

  const handleCreatePage = useCallback(
    (name: string) => {
      const page = createPage(name);
      setCreating(false);
      refresh();
      router.push({ pathname: '/page/[id]', params: { id: page.id } });
    },
    [refresh],
  );

  const handleRename = useCallback(
    (name: string) => {
      if (!renaming) {
        return;
      }
      renamePage(renaming.page.id, name);
      setRenaming(null);
      refresh();
    },
    [refresh, renaming],
  );

  const openPageOptions = useCallback(
    (entry: PageWithStickers) => {
      const count = entry.stickers.length;
      Alert.alert(entry.page.name, `${count} sticker`, [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Yeniden adlandır',
          onPress: () => setRenaming(entry),
        },
        {
          text: 'Sayfayı sil',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Sayfa silinsin mi?',
              count > 0
                ? `İçindeki ${count} sticker başka bir sayfaya taşınacak; başka sayfa yoksa silinecek.`
                : 'Bu sayfa silinecek.',
              [
                { text: 'Vazgeç', style: 'cancel' },
                {
                  text: 'Sil',
                  style: 'destructive',
                  onPress: () => {
                    const result = deletePage(entry.page.id);
                    if (result.deletedStickers > 0) {
                      Alert.alert(
                        'Sayfa silindi',
                        `Başka sayfa olmadığı için ${result.deletedStickers} sticker da silindi.`,
                      );
                    }
                    refresh();
                  },
                },
              ],
            );
          },
        },
      ]);
    },
    [refresh],
  );

  const header = (
    <View style={styles.header}>
      <View style={styles.topRow}>
        <Text style={styles.eyebrow}>STICKER SCRAPBOOK</Text>
        <View style={styles.countChip}>
          <Sparkles size={12} color={Colors.inkSoft} strokeWidth={2} />
          <Text style={styles.countText}>
            {totalStickers} sticker · {library.length} sayfa
          </Text>
        </View>
      </View>

      <Text style={styles.title}>
        Kes, biriktir,{'\n'}sayfalara yapıştır.
      </Text>
      <Text style={styles.subtitle}>
        Her sticker bir defter sayfasına yapışır. Sayfalar arasında gez, koleksiyonunu
        büyüt.
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
          onPress={() => {
            setEditorOriginPage(null);
            pickPhoto();
          }}
        />
        <View style={styles.secondaryRow}>
          <ActionButton
            label="Yeni sayfa"
            variant="secondary"
            compact
            style={styles.flex}
            icon={<Plus size={17} color={Colors.ink} strokeWidth={2} />}
            onPress={() => setCreating(true)}
            accessibilityHint="Koleksiyona boş bir sayfa ekler"
          />
          <ActionButton
            label="WhatsApp’a aktar"
            variant="secondary"
            compact
            style={styles.flex}
            icon={<Send size={16} color={Colors.ink} strokeWidth={2} />}
            onPress={() => router.push('/export')}
            accessibilityHint="Seçtiğin sticker'lardan WhatsApp sticker paketi oluşturur"
          />
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Sayfaların</Text>
          <Text style={styles.sectionSubtitle}>
            Bir sayfaya dokun; yeni kesimler oraya eklenir.
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
      <Text style={styles.emptyTitle}>İlk sayfanı aç</Text>
      <Text style={styles.emptyBody}>
        Fotoğraf çek ya da galeriden seç; kesilen sticker ilk sayfana yapışacak. Dilediğin
        kadar sayfa oluşturabilirsin.
      </Text>
      <ActionButton
        label="Sayfa oluştur"
        icon={<Plus size={17} color={Colors.white} strokeWidth={2} />}
        onPress={() => setCreating(true)}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <FlatList
        data={library}
        keyExtractor={(item) => item.page.id}
        numColumns={2}
        renderItem={({ item, index }) => (
          <PageCard
            entry={item}
            index={index}
            active={item.page.id === activeId}
            onOpen={() => openPage(item.page.id)}
            onOptions={() => openPageOptions(item)}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={emptyState}
        columnWrapperStyle={library.length > 0 ? styles.columns : undefined}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Spacing.six },
        ]}
        showsVerticalScrollIndicator={false}
      />

      <NameDialog
        visible={creating}
        title="Yeni sayfa"
        description="Sayfaya bir ad ver. Daha sonra değiştirebilirsin."
        confirmLabel="Oluştur"
        placeholder={`Sayfa ${library.length + 1}`}
        initialValue={creating ? suggestPageName() : ''}
        onCancel={() => setCreating(false)}
        onSubmit={handleCreatePage}
      />

      <NameDialog
        visible={Boolean(renaming)}
        title="Sayfayı adlandır"
        initialValue={renaming?.page.name ?? ''}
        confirmLabel="Kaydet"
        onCancel={() => setRenaming(null)}
        onSubmit={handleRename}
      />
    </SafeAreaView>
  );
}

function PageCard({
  entry,
  index,
  active,
  onOpen,
  onOptions,
}: {
  entry: PageWithStickers;
  index: number;
  active: boolean;
  onOpen: () => void;
  onOptions: () => void;
}) {
  const rotation = index % 2 === 0 ? '-0.9deg' : '0.9deg';
  const covers = entry.stickers.slice(0, 4);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.page.name} sayfasını aç`}
      accessibilityHint={`${entry.stickers.length} sticker`}
      onPress={onOpen}
      onLongPress={onOptions}
      delayLongPress={300}
      style={({ pressed }) => [
        styles.card,
        { transform: [{ rotate: rotation }] },
        pressed && styles.cardPressed,
      ]}>
      <View style={styles.cover}>
        {covers.length === 0 ? (
          <View style={styles.coverEmpty}>
            <Plus size={18} color={Colors.inkFaint} strokeWidth={1.6} />
          </View>
        ) : (
          <View style={styles.coverGrid}>
            {covers.map((sticker) => (
              <View
                key={sticker.id}
                style={[
                  styles.coverCell,
                  covers.length === 1 && styles.coverCellSingle,
                  covers.length === 2 && styles.coverCellHalf,
                ]}>
                <Image
                  source={{ uri: sticker.uri }}
                  style={styles.coverImage}
                  contentFit="contain"
                  transition={120}
                />
              </View>
            ))}
          </View>
        )}

        {active ? (
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>AKTİF</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {entry.page.name}
          </Text>
          <Text style={styles.cardMeta}>{entry.stickers.length} sticker</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sayfa seçenekleri"
          hitSlop={10}
          onPress={onOptions}
          style={styles.cardMenu}>
          <Pencil size={13} color={Colors.inkFaint} strokeWidth={2} />
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
  secondaryRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  flex: {
    flex: 1,
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
  cover: {
    aspectRatio: 1,
    borderRadius: Radius.sm,
    backgroundColor: Colors.paperDeep,
    overflow: 'hidden',
  },
  coverGrid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  coverCell: {
    width: '50%',
    height: '50%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  coverCellSingle: {
    width: '100%',
    height: '100%',
    padding: 10,
  },
  coverCellHalf: {
    width: '50%',
    height: '100%',
    padding: 6,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent,
  },
  activeBadgeText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 8,
    letterSpacing: 0.8,
    color: Colors.white,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingTop: 8,
    paddingBottom: 2,
    gap: Spacing.one,
  },
  cardTitleWrap: {
    flex: 1,
  },
  cardTitle: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    color: Colors.ink,
  },
  cardMeta: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: Colors.inkFaint,
    marginTop: 1,
  },
  cardMenu: {
    padding: 4,
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
    marginBottom: Spacing.one,
  },
});
