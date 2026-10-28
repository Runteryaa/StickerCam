import { Directory, File, Paths } from 'expo-file-system';

export type StickerSource = 'camera' | 'library' | 'ai';

export type StickerRecord = {
  id: string;
  uri: string;
  width: number;
  height: number;
  createdAt: number;
  source: StickerSource;
};

export type StagedSticker = StickerRecord;

const STICKER_DIR_NAME = 'stickers';
const STICKER_INDEX_NAME = 'index.json';
const DRAFT_DIR_NAME = 'sticker-drafts';

function getStickerDirectory(): Directory {
  return new Directory(Paths.document, STICKER_DIR_NAME);
}

function getStickerIndexFile(): File {
  return new File(getStickerDirectory(), STICKER_INDEX_NAME);
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
  const indexFile = getStickerIndexFile();
  if (!indexFile.exists) {
    indexFile.create({ intermediates: true });
  }
  indexFile.writeSync(JSON.stringify(records));
}

function createId(): string {
  return `sticker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Kayıtlı tüm sticker'ları (en yeni önce) döndürür ve silinmiş dosyaları ayıklar.
 */
export function listStickers(): StickerRecord[] {
  const records = readIndex();
  const valid = records.filter((record) => new File(record.uri).exists);
  if (valid.length !== records.length) {
    writeIndex(valid);
  }
  return [...valid].sort((a, b) => b.createdAt - a.createdAt);
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

  const id = createId();
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
  };
}

/**
 * Önizlemesi onaylanan sticker'ı kalıcı dizine taşır ve manifest'i günceller.
 */
export async function commitSticker(staged: StagedSticker): Promise<StickerRecord> {
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

  const record: StickerRecord = { ...staged, uri: destination.uri };
  writeIndex([record, ...readIndex()]);
  return record;
}

export function discardStaged(staged: StagedSticker | null): void {
  if (!staged) {
    return;
  }
  try {
    const file = new File(staged.uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Cache temizliği başarısız olsa da akışı bozmayız.
  }
}

export function deleteSticker(id: string): void {
  const records = readIndex();
  const record = records.find((item) => item.id === id);
  if (record) {
    try {
      const file = new File(record.uri);
      if (file.exists) {
        file.delete();
      }
    } catch {
      // Dosya zaten silinmiş olabilir.
    }
  }
  writeIndex(records.filter((item) => item.id !== id));
}
