import * as Application from 'expo-application';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';
import {
  FilterMode,
  ImageFormat,
  MipmapMode,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';

import { loadSkiaImage } from '@/services/skiaImageLoader';
import type { StickerRecord } from '@/services/stickerService';

/**
 * WhatsApp sticker paketi dışa aktarımı.
 *
 * WhatsApp paketleri yalnızca uygulamanın kendi `ContentProvider`'ı üzerinden
 * okur (bkz. `plugins/whatsapp-stickers/StickerContentProvider.kt`). Bu yüzden
 * burada 512×512 WebP dosyaları ve bir `pack.json` manifesti üretilir; native
 * provider bunları WhatsApp'a sunar.
 */

const PACKS_DIRECTORY = 'whatsapp-packs';
const PACK_MANIFEST = 'pack.json';
const EXPORT_CACHE_DIRECTORY = 'whatsapp-export';

/** WhatsApp statik sticker kuralları. */
const STICKER_SIZE = 512;
const TRAY_SIZE = 96;
const MAX_STICKER_BYTES = 100 * 1024;
const MAX_TRAY_BYTES = 50 * 1024;
export const MIN_PACK_SIZE = 3;
export const MAX_PACK_SIZE = 30;

/** WhatsApp'ın paket ekleme niyeti. */
const ENABLE_STICKER_PACK_ACTION = 'com.whatsapp.intent.action.ENABLE_STICKER_PACK';

const FALLBACK_PACKAGE_NAME = 'com.runterya.sticker';

export const WHATSAPP_AUTHORITY = `${
  Application.applicationId ?? FALLBACK_PACKAGE_NAME
}.stickercontentprovider`;

/** Bir sticker'a stilleri bozmayan varsayılan emojiler. */
const DEFAULT_EMOJIS = ['😀', '✨', '💛', '🔥', '🎉', '🌈', '💫', '🫶'];

const TURKISH_TO_ASCII: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  â: 'a',
  î: 'i',
  û: 'u',
};

type PackSticker = {
  imageFileName: string;
  emojis: string;
  accessibilityText: string;
};

type PackManifest = {
  identifier: string;
  name: string;
  publisher: string;
  publisherEmail: string;
  publisherWebsite: string;
  privacyPolicyWebsite: string;
  licenseAgreementWebsite: string;
  androidPlayStoreLink: string;
  iosAppDownloadLink: string;
  trayImageFile: string;
  imageDataVersion: string;
  avoidCache: boolean;
  animatedStickerPack: boolean;
  updatedAt: number;
  stickers: PackSticker[];
};

export type WhatsAppPack = {
  identifier: string;
  name: string;
  stickerCount: number;
  updatedAt: number;
  /** Önizlemede kullanılabilecek tray görselinin yerel uri'si. */
  trayUri: string;
};

export type ExportProgress = {
  done: number;
  total: number;
};

export function isWhatsAppExportSupported(): boolean {
  return Platform.OS === 'android';
}

function packsRootDirectory(): Directory {
  const directory = new Directory(Paths.document, PACKS_DIRECTORY);
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  return directory;
}

function exportCacheDirectory(): Directory {
  const directory = new Directory(Paths.cache, EXPORT_CACHE_DIRECTORY);
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  return directory;
}

function isSafeSegment(value: string): boolean {
  return /^[A-Za-z0-9_.-]{1,80}$/.test(value);
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[çğıöşüâîû]/g, (character) => TURKISH_TO_ASCII[character] ?? character)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function createPackIdentifier(name: string): string {
  const slug = slugify(name) || 'paket';
  const suffix = Math.random().toString(36).slice(2, 8);
  return `stickercam-${slug}-${suffix}`.slice(0, 78);
}

function readManifest(directory: Directory): PackManifest | null {
  try {
    const file = new File(directory, PACK_MANIFEST);
    if (!file.exists) {
      return null;
    }
    const parsed: unknown = JSON.parse(file.textSync());
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const manifest = parsed as Partial<PackManifest>;
    if (
      typeof manifest.name !== 'string' ||
      !Array.isArray(manifest.stickers) ||
      typeof manifest.trayImageFile !== 'string'
    ) {
      return null;
    }
    return manifest as PackManifest;
  } catch {
    return null;
  }
}

/** Cihazda hazırlanmış tüm WhatsApp paketlerini (en yeni önce) listeler. */
export function listPacks(): WhatsAppPack[] {
  const root = packsRootDirectory();
  const packs: WhatsAppPack[] = [];

  for (const entry of root.list()) {
    if (!(entry instanceof Directory)) {
      continue;
    }
    const identifier = entry.name;
    if (!isSafeSegment(identifier)) {
      continue;
    }
    const manifest = readManifest(entry);
    if (!manifest) {
      continue;
    }
    packs.push({
      identifier,
      name: manifest.name,
      stickerCount: manifest.stickers.length,
      updatedAt: typeof manifest.updatedAt === 'number' ? manifest.updatedAt : 0,
      trayUri: new File(entry, manifest.trayImageFile).uri,
    });
  }

  return packs.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deletePack(identifier: string): void {
  if (!isSafeSegment(identifier)) {
    return;
  }
  const directory = new Directory(packsRootDirectory(), identifier);
  if (directory.exists) {
    directory.delete();
  }
}

/**
 * Görseli kare, şeffaf bir tuvale "contain" mantığıyla yerleştirir.
 */
function renderSquare(
  image: SkImage,
  size: number,
  insetRatio: number,
): SkImage | null {
  const surface = Skia.Surface.Make(size, size);
  if (!surface) {
    return null;
  }

  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));

  const imageWidth = image.width();
  const imageHeight = image.height();
  if (imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }

  const inner = size * (1 - insetRatio * 2);
  const scale = Math.min(inner / imageWidth, inner / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;

  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  canvas.drawImageRectOptions(
    image,
    Skia.XYWHRect(0, 0, imageWidth, imageHeight),
    Skia.XYWHRect((size - width) / 2, (size - height) / 2, width, height),
    FilterMode.Linear,
    MipmapMode.Linear,
    paint,
  );
  surface.flush();

  return surface.makeImageSnapshot();
}

/** WebP dosyaları "RIFF....WEBP" ile başlar. */
function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length > 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

/**
 * Skia ile WebP kodlamayı dener. Encoder yoksa veya boyut sınırı aşılırsa
 * `null` döner; çağıran taraf ImageManipulator yedeğini kullanır.
 */
function encodeWithSkia(image: SkImage, maxBytes: number): Uint8Array | null {
  for (let quality = 90; quality >= 30; quality -= 10) {
    const bytes = image.encodeToBytes(ImageFormat.WEBP, quality);
    if (!bytes || bytes.length === 0 || !isWebp(bytes)) {
      return null;
    }
    if (bytes.length <= maxBytes) {
      return bytes;
    }
  }
  return null;
}

async function encodeWithImageManipulator(
  image: SkImage,
  maxBytes: number,
): Promise<Uint8Array> {
  const cache = exportCacheDirectory();
  const pngFile = new File(
    cache,
    `render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
  );
  pngFile.create({ overwrite: true, intermediates: true });
  pngFile.writeSync(image.encodeToBase64(ImageFormat.PNG), { encoding: 'base64' });

  try {
    let lastBytes: Uint8Array | null = null;
    for (const compress of [0.9, 0.75, 0.6, 0.45, 0.3]) {
      const rendered = await ImageManipulator.manipulate(pngFile.uri).renderAsync();
      const saved = await rendered.saveAsync({
        compress,
        format: SaveFormat.WEBP,
      });
      const bytes = new Uint8Array(await new File(saved.uri).arrayBuffer());
      if (bytes.length === 0) {
        continue;
      }
      lastBytes = bytes;
      if (bytes.length <= maxBytes) {
        return bytes;
      }
    }

    if (lastBytes) {
      // Sınırı aşsa bile elimizde geçerli bir WebP var; WhatsApp reddedecek olsa
      // da kullanıcıya boş bir dosya vermekten iyidir.
      return lastBytes;
    }
    throw new Error('Sticker WebP olarak kodlanamadı.');
  } finally {
    if (pngFile.exists) {
      pngFile.delete();
    }
  }
}

function writeBytes(file: File, bytes: Uint8Array): void {
  if (!file.exists) {
    file.create({ intermediates: true });
  }
  file.writeSync(bytes);
}

async function writeWebpFile(input: {
  sourceUri: string;
  destination: File;
  size: number;
  insetRatio: number;
  maxBytes: number;
}): Promise<void> {
  const image = await loadSkiaImage(input.sourceUri);
  const square = renderSquare(image, input.size, input.insetRatio);
  if (!square) {
    throw new Error('Sticker görseli hazırlanamadı.');
  }

  const skiaBytes = encodeWithSkia(square, input.maxBytes);
  if (skiaBytes) {
    writeBytes(input.destination, skiaBytes);
    return;
  }

  const fallbackBytes = await encodeWithImageManipulator(square, input.maxBytes);
  writeBytes(input.destination, fallbackBytes);
}

export type ExportPackInput = {
  name: string;
  stickers: StickerRecord[];
  onProgress?: (progress: ExportProgress) => void;
};

/**
 * Seçilen sticker'lardan WhatsApp uyumlu bir paket üretir. Aynı isimde bir
 * paket varsa içeriği güncellenir; böylece WhatsApp'ta kopya paket oluşmaz.
 */
export async function exportStickerPack(input: ExportPackInput): Promise<WhatsAppPack> {
  if (!isWhatsAppExportSupported()) {
    throw new Error('WhatsApp paketleri şu anda yalnızca Android cihazlarda oluşturulabilir.');
  }

  const name = input.name.trim() || 'StickerCam Paketi';
  if (input.stickers.length < MIN_PACK_SIZE) {
    throw new Error(`WhatsApp için en az ${MIN_PACK_SIZE} sticker seçmelisin.`);
  }
  if (input.stickers.length > MAX_PACK_SIZE) {
    throw new Error(`WhatsApp bir pakette en fazla ${MAX_PACK_SIZE} sticker kabul ediyor.`);
  }

  const existing = listPacks().find(
    (pack) => pack.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'),
  );
  const identifier = existing?.identifier ?? createPackIdentifier(name);

  const packDirectory = new Directory(packsRootDirectory(), identifier);
  if (!packDirectory.exists) {
    packDirectory.create({ intermediates: true, idempotent: true });
  }

  // Yeniden dışa aktarımda eski dosyalar paket içinde kalmasın.
  for (const entry of packDirectory.list()) {
    try {
      entry.delete();
    } catch {
      // Silinemeyen dosya manifestte yer almadığı sürece sorun değil.
    }
  }

  const total = input.stickers.length + 1;
  const packStickers: PackSticker[] = [];

  for (let index = 0; index < input.stickers.length; index += 1) {
    const sticker = input.stickers[index];
    const imageFileName = `sticker-${String(index + 1).padStart(2, '0')}.webp`;
    await writeWebpFile({
      sourceUri: sticker.uri,
      destination: new File(packDirectory, imageFileName),
      size: STICKER_SIZE,
      insetRatio: 0.04,
      maxBytes: MAX_STICKER_BYTES,
    });
    packStickers.push({
      imageFileName,
      emojis: DEFAULT_EMOJIS[index % DEFAULT_EMOJIS.length],
      accessibilityText: '',
    });
    input.onProgress?.({ done: index + 1, total });
  }

  const trayImageFile = 'tray.webp';
  await writeWebpFile({
    sourceUri: input.stickers[0].uri,
    destination: new File(packDirectory, trayImageFile),
    size: TRAY_SIZE,
    insetRatio: 0.06,
    maxBytes: MAX_TRAY_BYTES,
  });
  input.onProgress?.({ done: total, total });

  const manifest: PackManifest = {
    identifier,
    name,
    publisher: 'StickerCam',
    publisherEmail: 'runterya@users.noreply.github.com',
    publisherWebsite: '',
    privacyPolicyWebsite: '',
    licenseAgreementWebsite: '',
    androidPlayStoreLink: '',
    iosAppDownloadLink: '',
    trayImageFile,
    imageDataVersion: String(Date.now()),
    avoidCache: true,
    animatedStickerPack: false,
    updatedAt: Date.now(),
    stickers: packStickers,
  };

  const manifestFile = new File(packDirectory, PACK_MANIFEST);
  if (!manifestFile.exists) {
    manifestFile.create({ intermediates: true });
  }
  manifestFile.writeSync(JSON.stringify(manifest));

  return {
    identifier,
    name,
    stickerCount: packStickers.length,
    updatedAt: manifest.updatedAt,
    trayUri: new File(packDirectory, trayImageFile).uri,
  };
}

/** WhatsApp'ı açıp paketi ekleme onay ekranını gösterir. */
export async function openPackInWhatsApp(pack: WhatsAppPack): Promise<void> {
  if (!isWhatsAppExportSupported()) {
    throw new Error('WhatsApp paketleri yalnızca Android cihazlarda açılabilir.');
  }

  await IntentLauncher.startActivityAsync(ENABLE_STICKER_PACK_ACTION, {
    extra: {
      sticker_pack_id: pack.identifier,
      sticker_pack_authority: WHATSAPP_AUTHORITY,
      sticker_pack_name: pack.name,
    },
  });
}
