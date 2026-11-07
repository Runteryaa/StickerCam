import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft, Check, MessageCircle, Plus, Send, Trash2 } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/ActionButton';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import {
  loadLibrary,
  type PageWithStickers,
  type StickerRecord,
} from '@/services/stickerService';
import {
  deletePack,
  exportStickerPack,
  isWhatsAppExportSupported,
  listPacks,
  MAX_PACK_SIZE,
  MIN_PACK_SIZE,
  openPackInWhatsApp,
  type ExportProgress,
  type WhatsAppPack,
} from '@/services/whatsappStickerService';

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Beklenmeyen bir hata oluştu.';
}

export default function ExportScreen() {
  const insets = useSafeAreaInsets();
  const [stickers, setStickers] = useState<StickerRecord[]>([]);
  const [pages, setPages] = useState<PageWithStickers[]>([]);
  const [pageFilter, setPageFilter] = useState<string | null>(null);
  const [packs, setPacks] = useState<WhatsAppPack[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [packName, setPackName] = useState('StickerCam Paketim');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const initialized = useRef(false);

  const refresh = useCallback(() => {
    const library = loadLibrary();
    const available = library
      .flatMap((entry) => entry.stickers)
      .sort((a, b) => b.createdAt - a.createdAt);
    setPages(library);
    setStickers(available);
    setPacks(listPacks());

    if (!initialized.current && available.length > 0) {
      initialized.current = true;
      setSelectedIds(available.slice(0, MAX_PACK_SIZE).map((sticker) => sticker.id));
    }
  }, []);

  // Ekran her açıldığında defterdeki sticker'lar ve hazır paketler tazelenir.
  const load = useCallback(() => {
    try {
      refresh();
    } catch {
      setPages([]);
      setStickers([]);
      setPacks([]);
    }
  }, [refresh]);

  useFocusEffect(load);

  const visibleStickers =
    pageFilter === null
      ? stickers
      : stickers.filter((sticker) => sticker.pageId === pageFilter);

  const selectedStickers = stickers.filter((sticker) => selectedIds.includes(sticker.id));
  const supported = isWhatsAppExportSupported();
  const canExport = supported && !busy && selectedStickers.length >= MIN_PACK_SIZE;

  const toggleSticker = useCallback((id: string) => {
    setSelectedIds((current) => {
      if (current.includes(id)) {
        return current.filter((item) => item !== id);
      }
      if (current.length >= MAX_PACK_SIZE) {
        Alert.alert(
          'Paket doldu',
          `WhatsApp bir pakette en fazla ${MAX_PACK_SIZE} sticker kabul ediyor.`,
        );
        return current;
      }
      return [...current, id];
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(visibleStickers.slice(0, MAX_PACK_SIZE).map((sticker) => sticker.id));
  }, [visibleStickers]);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const handleExport = useCallback(async () => {
    if (selectedStickers.length < MIN_PACK_SIZE) {
      Alert.alert(
        'Birkaç sticker daha seç',
        `WhatsApp paketleri en az ${MIN_PACK_SIZE} sticker içerebilir.`,
      );
      return;
    }

    setBusy(true);
    setProgress({ done: 0, total: selectedStickers.length + 1 });

    try {
      const pack = await exportStickerPack({
        name: packName,
        stickers: selectedStickers,
        onProgress: setProgress,
      });
      setPacks(listPacks());
      setBusy(false);
      setProgress(null);

      try {
        await openPackInWhatsApp(pack);
      } catch {
        Alert.alert(
          'WhatsApp açılamadı',
          'Paket hazır ama WhatsApp açılırken bir sorun oldu. WhatsApp kurulu mu? Paketi aşağıdaki listeden yeniden açabilirsin.',
        );
        return;
      }

      setPacks(listPacks());
    } catch (error) {
      Alert.alert('Paket oluşturulamadı', errorMessage(error));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [packName, selectedStickers]);

  const handleOpenPack = useCallback(async (pack: WhatsAppPack) => {
    try {
      await openPackInWhatsApp(pack);
    } catch {
      Alert.alert(
        'WhatsApp açılamadı',
        'WhatsApp kurulu görünmüyor. Paketi eklemek için WhatsApp’ı yükleyip tekrar dene.',
      );
    }
  }, []);

  const confirmDeletePack = useCallback((pack: WhatsAppPack) => {
    Alert.alert(
      'Paket silinsin mi?',
      `"${pack.name}" paketinin dosyaları cihazdan kaldırılacak. WhatsApp’a daha önce eklediysen oradaki kopya kalır.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: () => {
            deletePack(pack.identifier);
            setPacks(listPacks());
          },
        },
      ],
    );
  }, []);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Geri dön"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <ArrowLeft size={20} color={Colors.ink} strokeWidth={2} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>DIŞA AKTAR</Text>
          <Text style={styles.title}>WhatsApp paketi</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Spacing.six },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.infoCard}>
          <MessageCircle size={18} color={Colors.mint} strokeWidth={2} />
          <Text style={styles.infoText}>
            Seçtiğin sticker’lar 512×512 şeffaf WebP’ye dönüştürülür ve WhatsApp’ın
            sticker klavyesine paket olarak eklenir. En az {MIN_PACK_SIZE}, en fazla{' '}
            {MAX_PACK_SIZE} sticker seçebilirsin.
          </Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>PAKET ADI</Text>
          <TextInput
            value={packName}
            onChangeText={setPackName}
            placeholder="StickerCam Paketim"
            placeholderTextColor={Colors.inkFaint}
            style={styles.input}
            maxLength={40}
            editable={!busy}
          />
          <Text style={styles.fieldHint}>
            Aynı adla tekrar aktarırsan paket güncellenir, kopyası oluşmaz.
          </Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Sticker seç</Text>
          <Text style={styles.selectionCount}>
            {selectedStickers.length}/{MAX_PACK_SIZE}
          </Text>
        </View>

        <View style={styles.selectionActions}>
          <Pressable
            accessibilityRole="button"
            onPress={selectAll}
            style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
            <Text style={styles.chipText}>Tümünü seç</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={clearSelection}
            style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
            <Text style={styles.chipText}>Temizle</Text>
          </Pressable>
        </View>

        {pages.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: pageFilter === null }}
              onPress={() => setPageFilter(null)}
              style={({ pressed }) => [
                styles.filterChip,
                pageFilter === null && styles.filterChipActive,
                pressed && styles.pressed,
              ]}>
              <Text
                style={[
                  styles.filterChipText,
                  pageFilter === null && styles.filterChipTextActive,
                ]}>
                Tüm sayfalar · {stickers.length}
              </Text>
            </Pressable>
            {pages.map((entry) => (
              <Pressable
                key={entry.page.id}
                accessibilityRole="button"
                accessibilityState={{ selected: pageFilter === entry.page.id }}
                onPress={() => setPageFilter(entry.page.id)}
                style={({ pressed }) => [
                  styles.filterChip,
                  pageFilter === entry.page.id && styles.filterChipActive,
                  pressed && styles.pressed,
                ]}>
                <Text
                  style={[
                    styles.filterChipText,
                    pageFilter === entry.page.id && styles.filterChipTextActive,
                  ]}>
                  {entry.page.name} · {entry.stickers.length}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {visibleStickers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              {stickers.length === 0 ? 'Henüz sticker yok' : 'Bu sayfa boş'}
            </Text>
            <Text style={styles.emptyBody}>
              {stickers.length === 0
                ? 'Önce kamera veya galeriden bir sticker oluştur, sonra buradan pakete ekle.'
                : 'Bu sayfada sticker yok. Başka bir sayfa seç ya da o sayfaya sticker ekle.'}
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {visibleStickers.map((sticker) => {
              const index = selectedIds.indexOf(sticker.id);
              const isSelected = index >= 0;
              return (
                <Pressable
                  key={sticker.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => toggleSticker(sticker.id)}
                  style={({ pressed }) => [
                    styles.gridItem,
                    isSelected && styles.gridItemSelected,
                    pressed && styles.pressed,
                  ]}>
                  <View style={styles.gridImageWrap}>
                    <Image
                      source={{ uri: sticker.uri }}
                      style={styles.gridImage}
                      contentFit="contain"
                      transition={100}
                    />
                  </View>
                  {isSelected ? (
                    <View style={styles.checkBadge}>
                      <Check size={12} color={Colors.white} strokeWidth={3} />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}

        {!supported ? (
          <Text style={styles.warning}>
            WhatsApp paketleri şu anda yalnızca Android cihazlarda oluşturulabilir.
            Diğer cihazlarda sticker’ları paylaşım menüsüyle gönderebilirsin.
          </Text>
        ) : null}

        <ActionButton
          label={busy ? 'Paket hazırlanıyor…' : 'WhatsApp’a ekle'}
          icon={<Send size={18} color={Colors.white} strokeWidth={2} />}
          onPress={handleExport}
          disabled={!canExport}
          loading={busy}
        />

        {progress ? (
          <View style={styles.progressRow}>
            <ActivityIndicator color={Colors.accent} size="small" />
            <Text style={styles.progressText}>
              {progress.done}/{progress.total} sticker hazırlanıyor
            </Text>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Hazır paketler</Text>
          <Text style={styles.selectionCount}>{packs.length}</Text>
        </View>

        {packs.length === 0 ? (
          <Text style={styles.packsEmpty}>
            Henüz paket yok. Yukarıdan sticker seçip “WhatsApp’a ekle”ye dokun.
          </Text>
        ) : (
          <View style={styles.packList}>
            {packs.map((pack) => (
              <View key={pack.identifier} style={styles.packRow}>
                <View style={styles.packTray}>
                  <Image
                    source={{ uri: pack.trayUri }}
                    style={styles.packTrayImage}
                    contentFit="contain"
                  />
                </View>
                <View style={styles.packInfo}>
                  <Text style={styles.packName} numberOfLines={1}>
                    {pack.name}
                  </Text>
                  <Text style={styles.packMeta}>{pack.stickerCount} sticker</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${pack.name} paketini WhatsApp'ta aç`}
                  onPress={() => handleOpenPack(pack)}
                  style={({ pressed }) => [styles.packAction, pressed && styles.pressed]}>
                  <Plus size={16} color={Colors.mint} strokeWidth={2.4} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${pack.name} paketini sil`}
                  onPress={() => confirmDeletePack(pack)}
                  style={({ pressed }) => [styles.packAction, pressed && styles.pressed]}>
                  <Trash2 size={15} color={Colors.inkFaint} strokeWidth={2} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.footerNote}>
          WhatsApp’ta açılan onay ekranında “Ekle”ye dokunman gerekiyor. Sticker’lar
          daha sonra WhatsApp’ın sticker klavyesinde görünür.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.paper,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.paperDeep,
  },
  headerText: {
    flex: 1,
  },
  eyebrow: {
    fontFamily: Fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 2.2,
    color: Colors.inkFaint,
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 28,
    color: Colors.ink,
    marginTop: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    gap: Spacing.three,
  },
  infoCard: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'flex-start',
    padding: Spacing.three,
    borderRadius: Radius.md,
    backgroundColor: Colors.mintSoft,
    borderWidth: 1,
    borderColor: '#C3E1D6',
  },
  infoText: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: 12.5,
    lineHeight: 19,
    color: Colors.inkSoft,
  },
  field: {
    gap: Spacing.one,
  },
  fieldLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 2,
    color: Colors.inkFaint,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.paperLine,
    backgroundColor: Colors.card,
    fontFamily: Fonts.sansMedium,
    fontSize: 15,
    color: Colors.ink,
  },
  fieldHint: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    color: Colors.inkFaint,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
  sectionTitle: {
    fontFamily: Fonts.serif,
    fontSize: 20,
    color: Colors.ink,
  },
  selectionCount: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: Colors.inkFaint,
  },
  selectionActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: Colors.paperDeep,
  },
  chipText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 11.5,
    color: Colors.inkSoft,
  },
  filterRow: {
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  filterChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.paperLine,
    backgroundColor: Colors.card,
  },
  filterChipActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentSoft,
  },
  filterChipText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 11.5,
    color: Colors.inkSoft,
  },
  filterChipTextActive: {
    color: Colors.accentDeep,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  gridItem: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.paperLine,
    backgroundColor: Colors.card,
    padding: 4,
  },
  gridItemSelected: {
    borderColor: Colors.accent,
    borderWidth: 2,
    backgroundColor: Colors.accentSoft,
  },
  gridImageWrap: {
    flex: 1,
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
  checkBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
  },
  emptyCard: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.paperLine,
    borderRadius: Radius.md,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.one,
  },
  emptyTitle: {
    fontFamily: Fonts.serif,
    fontSize: 18,
    color: Colors.ink,
  },
  emptyBody: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.inkSoft,
    textAlign: 'center',
  },
  warning: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.danger,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  progressText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 12,
    color: Colors.inkSoft,
  },
  packsEmpty: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.inkFaint,
  },
  packList: {
    gap: Spacing.two,
  },
  packRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.paperLine,
    backgroundColor: Colors.card,
  },
  packTray: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    backgroundColor: Colors.paperDeep,
    padding: 3,
  },
  packTrayImage: {
    width: '100%',
    height: '100%',
  },
  packInfo: {
    flex: 1,
  },
  packName: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13.5,
    color: Colors.ink,
  },
  packMeta: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.inkFaint,
    marginTop: 2,
  },
  packAction: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.paperDeep,
  },
  pressed: {
    opacity: 0.75,
  },
  footerNote: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    lineHeight: 17,
    color: Colors.inkFaint,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
});
