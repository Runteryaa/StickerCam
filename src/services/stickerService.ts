import { Directory, File, Paths } from 'expo-file-system';

export type StickerSource = 'camera' | 'library' | 'ai' | 'share';

export type StickerRecord = {
  id: string;
  uri: string;
  width: number;
  height: number;
  createdAt: number;
  source: StickerSource;
  /** Sticker'ın yapıştırıldığı defter sayfası. */
  pageId?: string | null;
};

export type StagedSticker = StickerRecord;

/** Defter sayfası: sticker'lar burada birikir. */
export type ScrapbookPage = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

const STICKER_DIR_NAME = 'stickers';
const STICKER_INDEX_NAME = 'index.json';
const PAGE_INDEX_NAME = 'pages.json';
const ACTIVE_PAGE_NAME = 'active-page.json';
const DRAFT_DIR_NAME = 'sticker-drafts';

const DEFAULT_PAGE_NAME = 'İlk sayfa';

function getStickerDirectory(): Directory {
  return new Directory(Paths.document, STICKER_DIR_NAME);
}

function getStickerIndexFile(): File {
  return new File(getStickerDirectory(), STICKER_INDEX_NAME);
}

function getPageIndexFile(): File {
  return new File(getStickerDirectory(), PAGE_INDEX_NAME);
}

function getActivePageFile(): File {
  return new File(getStickerDirectory(), ACTIVE_PAGE_NAME);
}

function ensureStickerDirectory(): Directory {
  const directory = getStickerDirectory();
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  return directory;
}

function isStickerRecord(value: unknown): value is StickerRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<StickerRecord>;
  return (
    typeof record.id === 'string' &&
    typeof record.uri === 'string' &&
    typeof record.width === 'number' &&
    typeof record.height === 'number' &&
    typeof record.createdAt === 'number'
  );
}

function isPageRecord(value: unknown): value is ScrapbookPage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const page = value as Partial<ScrapbookPage>;
  return (
    typeof page.id === 'string' &&
    typeof page.name === 'string' &&
    typeof page.createdAt === 'number'
  );
}

function readIndex(): StickerRecord[] {
  try {
    const indexFile = getStickerIndexFile();
    if (!indexFile.exists) {
      return [];
    }
    const parsed: unknown = JSON.parse(indexFile.textSync());
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isStickerRecord);
  } catch {
    return [];
  }
}

function writeIndex(records: StickerRecord[]): void {
  ensureStickerDirectory();
  const indexFile = getStickerIndexFile();
  if (!indexFile.exists) {
    indexFile.create({ intermediates: true });
  }
  indexFile.writeSync(JSON.stringify(records));
}

function readPages(): ScrapbookPage[] {
  try {
    const pageFile = getPageIndexFile();
    if (!pageFile.exists) {
      return [];
    }
    const parsed: unknown = JSON.parse(pageFile.textSync());
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isPageRecord);
  } catch {
    return [];
  }
}

function writePages(pages: ScrapbookPage[]): void {
  ensureStickerDirectory();
  const pageFile = getPageIndexFile();
  if (!pageFile.exists) {
    pageFile.create({ intermediates: true });
  }
  pageFile.writeSync(JSON.stringify(pages));
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createPageRecord(name: string): ScrapbookPage {
  const now = Date.now();
  return {
    id: createId('page'),
    name,
    createdAt: now,
    updatedAt: now,
  };
}

/** "Sayfa 1", "Sayfa 2" … çakışmayan bir varsayılan ad üretir. */
function nextPageName(pages: ScrapbookPage[]): string {
  if (pages.length === 0) {
    return DEFAULT_PAGE_NAME;
  }
  const used = new Set(pages.map((page) => page.name));
  let counter = pages.length + 1;
  while (used.has(`Sayfa ${counter}`)) {
    counter += 1;
  }
  return `Sayfa ${counter}`;
}

/** Yeni sayfa diyaloğunda önerilecek ad. */
export function suggestPageName(): string {
  return nextPageName(readPages());
}

/** Var olan dosyaları kontrol edip index'i temizler. */
function pruneStickers(records: StickerRecord[]): StickerRecord[] {
  const valid = records.filter((record) => {
    try {
      return new File(record.uri).exists;
    } catch {
      return false;
    }
  });
  if (valid.length !== records.length) {
    writeIndex(valid);
  }
  return valid;
}

/**
 * Sayfa ve sticker atamalarını tutarlı hale getirir.
 *
 * - Silinmiş dosyaların kayıtları düşer.
 * - Sayfası olmayan (ya da silinmiş sayfaya ait) sticker'lar ilk sayfaya taşınır.
 * - Hiç sayfa yoksa ve sticker varsa bir sayfa oluşturulur.
 *
 * Eski sürümlerden gelen sticker'lar böylece kaybolmadan bir sayfaya yerleşir.
 */
function normalizeLibrary(): { pages: ScrapbookPage[]; stickers: StickerRecord[] } {
  let pages = readPages();
  let stickers = pruneStickers(readIndex());

  if (pages.length === 0 && stickers.length === 0) {
    return { pages: [], stickers: [] };
  }

  if (pages.length === 0) {
    pages = [createPageRecord(DEFAULT_PAGE_NAME)];
    writePages(pages);
  }

  const pageIds = new Set(pages.map((page) => page.id));
  const fallback = pages[0].id;
  let changed = false;

  stickers = stickers.map((sticker) => {
    if (!sticker.pageId || !pageIds.has(sticker.pageId)) {
      changed = true;
      return { ...sticker, pageId: fallback };
    }
    return sticker;
  });

  if (changed) {
    writeIndex(stickers);
  }

  return { pages, stickers };
}

/** Kayıtlı tüm sticker'ları (en yeni önce) döndürür. */
export function listStickers(): StickerRecord[] {
  const stickers = normalizeLibrary().stickers;
  return [...stickers].sort((a, b) => b.createdAt - a.createdAt);
}

export type PageWithStickers = {
  page: ScrapbookPage;
  stickers: StickerRecord[];
};

/** Sayfaları, her birinin sticker'larıyla (en yeni önce) döndürür. */
export function loadLibrary(): PageWithStickers[] {
  const { pages, stickers } = normalizeLibrary();

  return [...pages]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((page) => ({
      page,
      stickers: stickers
        .filter((sticker) => sticker.pageId === page.id)
        .sort((a, b) => b.createdAt - a.createdAt),
    }));
}

export function getPage(pageId: string): PageWithStickers | null {
  return loadLibrary().find((entry) => entry.page.id === pageId) ?? null;
}

export function getActivePageId(): string | null {
  try {
    const file = getActivePageFile();
    if (!file.exists) {
      return null;
    }
    const parsed: unknown = JSON.parse(file.textSync());
    if (typeof parsed === 'string' && parsed.length > 0) {
      return parsed;
    }
    if (parsed && typeof parsed === 'object') {
      const id = (parsed as { id?: unknown }).id;
      if (typeof id === 'string') {
        return id;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function setActivePageId(pageId: string | null): void {
  ensureStickerDirectory();
  const file = getActivePageFile();
  if (!file.exists) {
    file.create({ intermediates: true });
  }
  file.writeSync(JSON.stringify(pageId));
}

/**
 * Yeni sticker'ların gideceği sayfa.
 *
 * Aktif sayfa geçerliyse o; değilse ilk sayfa; hiç sayfa yoksa yeni bir
 * "İlk sayfa" oluşturulur.
 */
export function ensureActivePage(): ScrapbookPage {
  const { pages } = normalizeLibrary();
  if (pages.length === 0) {
    const created = createPageRecord(DEFAULT_PAGE_NAME);
    writePages([created]);
    setActivePageId(created.id);
    return created;
  }

  const activeId = getActivePageId();
  const active = pages.find((page) => page.id === activeId);
  if (active) {
    return active;
  }

  const first = [...pages].sort((a, b) => a.createdAt - b.createdAt)[0];
  setActivePageId(first.id);
  return first;
}

/** Yeni bir sayfa oluşturur ve aktif sayfa yapar. */
export function createPage(name?: string): ScrapbookPage {
  const { pages } = normalizeLibrary();
  const trimmed = name?.trim();
  const page = createPageRecord(trimmed && trimmed.length > 0 ? trimmed : nextPageName(pages));
  writePages([...pages, page]);
  setActivePageId(page.id);
  return page;
}

/** Sayfayı yeniden adlandırır. Boş ad yok sayılır. */
export function renamePage(pageId: string, name: string): ScrapbookPage | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const pages = readPages();
  let updated: ScrapbookPage | null = null;
  const next = pages.map((page) => {
    if (page.id !== pageId) {
      return page;
    }
    updated = { ...page, name: trimmed, updatedAt: Date.now() };
    return updated;
  });
  if (updated) {
    writePages(next);
  }
  return updated;
}

export type DeletePageResult = {
  /** Sticker'lar taşındıysa hedef sayfa. */
  movedToPageId: string | null;
  /** Taşınacak sayfa yoktu, sticker'lar silindi. */
  deletedStickers: number;
};

/**
 * Sayfayı siler.
 *
 * İçindeki sticker'lar varsa başka bir sayfaya taşınır. Başka sayfa yoksa
 * (bu tek sayfaysa) sticker'lar da silinir; çağıran taraf kullanıcıyı uyarır.
 */
export function deletePage(pageId: string): DeletePageResult {
  const { pages, stickers } = normalizeLibrary();
  const remaining = pages.filter((page) => page.id !== pageId);
  const pageStickers = stickers.filter((sticker) => sticker.pageId === pageId);

  if (remaining.length === 0) {
    for (const sticker of pageStickers) {
      removeStickerFile(sticker);
    }
    writeIndex(stickers.filter((sticker) => sticker.pageId !== pageId));
    writePages([]);
    setActivePageId(null);
    return {
      movedToPageId: null,
      deletedStickers: pageStickers.length,
    };
  }

  const target = remaining[0].id;
  writeIndex(
    stickers.map((sticker) =>
      sticker.pageId === pageId ? { ...sticker, pageId: target } : sticker,
    ),
  );
  writePages(remaining);
  if (getActivePageId() === pageId) {
    setActivePageId(target);
  }

  return {
    movedToPageId: target,
    deletedStickers: 0,
  };
}

/** Sticker'ı başka bir sayfaya taşır. */
export function moveStickerToPage(stickerId: string, pageId: string): void {
  const stickers = readIndex();
  writeIndex(
    stickers.map((sticker) =>
      sticker.id === stickerId ? { ...sticker, pageId } : sticker,
    ),
  );
  const pages = readPages();
  writePages(
    pages.map((page) =>
      page.id === pageId ? { ...page, updatedAt: Date.now() } : page,
    ),
  );
}

/**
 * Kesilen sticker'ı önizleme için cache'te tutar (henüz deftere kaydedilmedi).
 */
export function stageSticker(input: {
  base64: string;
  width: number;
  height: number;
  source: StickerSource;
}): StagedSticker {
  const directory = new Directory(Paths.cache, DRAFT_DIR_NAME);
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }

  const id = createId('sticker');
  const file = new File(directory, `${id}.png`);
  file.create({ overwrite: true, intermediates: true });
  file.writeSync(input.base64, { encoding: 'base64' });

  return {
    id,
    uri: file.uri,
    width: input.width,
    height: input.height,
    createdAt: Date.now(),
    source: input.source,
    pageId: null,
  };
}

/**
 * Önizlemesi onaylanan sticker'ı kalıcı dizine taşır ve sayfaya yapıştırır.
 *
 * Sayfa verilmezse aktif sayfa kullanılır; hiç sayfa yoksa "İlk sayfa"
 * oluşturulur. Böylece her kayıt bir sayfada birikir.
 */
export async function commitSticker(
  staged: StagedSticker,
  pageId?: string,
): Promise<StickerRecord> {
  const directory = ensureStickerDirectory();
  const destination = new File(directory, `${staged.id}.png`);
  const source = new File(staged.uri);

  if (!source.exists) {
    throw new Error('Sticker dosyası bulunamadı.');
  }

  if (destination.exists) {
    destination.delete();
  }
  await source.move(destination);

  const targetPage = pageId ?? ensureActivePage().id;
  const record: StickerRecord = {
    ...staged,
    uri: destination.uri,
    pageId: targetPage,
  };

  writeIndex([record, ...readIndex()]);

  const pages = readPages();
  writePages(
    pages.map((page) =>
      page.id === targetPage ? { ...page, updatedAt: Date.now() } : page,
    ),
  );

  return record;
}

export function discardStaged(staged: StagedSticker | null): void {
  if (!staged) {
    return;
  }
  removeStickerFile(staged);
}

function removeStickerFile(record: Pick<StickerRecord, 'uri'>): void {
  try {
    const file = new File(record.uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Cache/dosya temizliği başarısız olsa da akışı bozmayız.
  }
}

export function deleteSticker(id: string): void {
  const records = readIndex();
  const record = records.find((item) => item.id === id);
  if (record) {
    removeStickerFile(record);
  }
  writeIndex(records.filter((item) => item.id !== id));
}

/** Toplam sticker sayısı (rozetler için). */
export function countStickers(): number {
  return readIndex().filter((record) => {
    try {
      return new File(record.uri).exists;
    } catch {
      return false;
    }
  }).length;
}
