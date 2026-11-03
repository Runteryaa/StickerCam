# StickerCam

Kamera veya galeriden bir fotoğraf seç, istediğin nesnenin etrafını çiz (veya akıllı
seçimle dokun) ve geriye şeffaf, beyaz konturlu bir sticker kalsın. Sticker'lar
cihazda birikir; sonraki fazda damalı kağıt sayfalara otomatik yerleştirilecek.

Expo SDK 58 · React Native 0.88 · Expo Router · TypeScript · Skia · Reanimated

## Uygulama kimliği

- Görünen ad: **StickerCam**
- Hedef platformlar: **Android ve iOS** (web desteği kaldırıldı)
- Android `package` / iOS `bundleIdentifier`: **`com.runterya.sticker`**
- URL şeması: `stickercam`
- EAS projesi: [`@runterya/stickercam`](https://expo.dev/accounts/runterya/projects/stickercam)

> Android package ve iOS bundle identifier yalnızca ASCII harf, rakam ve nokta
> kabul eder; bu yüzden `ı` yerine `u` kullanılıyor.

## Bu fazda hazır olanlar

- **Kamera**: izin akışı, ön/arka kamera, ışık (torch), deklanşör, galeri kısayolu.
- **Galeri**: `expo-image-picker` ile seçim, EXIF yönünün düzeltilmesi ve 2048 px'e
  normalize edilmesi (`expo-image-manipulator`).
- **Serbest çizim (lasso)**: parmakla çizilen kapalı seçim, orta nokta yumuşatmalı
  path, seçim dışının karartılması. Tamamen offline.
- **Dört köşe**: sürüklenebilir dört tutamaçla düz kenarlı kesim. Köşe tutamacı
  nesneye oturtulur; dörtgenin içinden sürükleyince tüm seçim taşınır.
- **Akıllı seçim**: cihaz üzerinde çalışan MediaPipe **MagicTouch** modeli
  (`modules/smart-cutout`). Model APK'nın içinde gelir, internet gerekmez.
  Nesneye dokunduğunda maske anında görselin üzerinde önizlenir; “Ekle” ile
  seçimi genişletip “Çıkar” ile yanlış bölgeleri işaretleyebilirsin. Model
  durumlu çalıştığı için görsel özellikleri bir kez çıkarılır ve her dokunuş
  ~200 ms'de yeni maske üretir. Maske, güven değerinden gelen yumuşak alfa ile
  orijinal görsele `DstIn` uygulanır; kenarlar bu yüzden merdiven görünmez.
  Model yüklenemezse (veya iOS'ta) benzer renkli bağlantılı bölgeyi seçen yerel
  yedek algoritma devreye girer.
- **Kesim**: lasso path'i görsel piksel uzayına taşınır, Skia offscreen surface
  üzerinde kırpılır, tamamen şeffaf kenarlar kırpılır (sıkı bbox), beyaz sticker
  konturu dosyaya işlenir ve PNG olarak kaydedilir.
- **Kalıcılık**: sticker PNG'leri `document/stickers/` altında, metadata
  `stickers/index.json` manifestinde. Önizleme onaylanmadan dosya kalıcı dizine
  taşınmaz; vazgeçilen taslaklar cache'ten silinir.
- **Defter (sticker tepsisi)**: ana ekranda grid, önizleme, silme, canlı sayaç.
- **WhatsApp sticker paketi**: seçilen sticker'lar 512×512 şeffaf WebP'ye (≤100 KB)
  ve 96×96 tray ikonuna dönüştürülür, `document/whatsapp-packs/<id>/` altına
  yazılır. Paket, WhatsApp'ın beklediği `com.whatsapp.sticker.READ` izinli
  `ContentProvider` üzerinden sunulur ve
  `com.whatsapp.intent.action.ENABLE_STICKER_PACK` niyetiyle ekleme ekranı açılır.
  Native provider `plugins/withWhatsAppStickers.js` config plugin'i ile üretilir;
  bu yüzden paket aktarımı **Expo Go'da çalışmaz**, derlenmiş APK gerekir.
- **Diğer uygulamalar**: önizlemedeki “Paylaş” aksiyonu sticker'ı şeffaf PNG
  olarak sistem paylaşım menüsüne verir (Instagram, TikTok, mesaj uygulamaları).
- **Paylaşımdan içe alma**: Android paylaşım menüsünde StickerCam görünür
  (`ACTION_SEND` / `image/*`). Paylaşılan görsel doğrudan editörde açılır; native
  taraf `content://` baytlarını cache'e kopyalar (`modules/share-intent`).
  Paylaşılan görsellerde **kırpma zorunlu değildir**: editördeki “Kırpmadan
  kaydet” aksiyonu görselin tamamını sticker yapar. PNG/WebP gibi alfa taşıyan
  kaynaklar yeniden kodlanırken **şeffaflık korunur** (JPEG'e çevrilmez) ve hazır
  sticker'lara ayrıca beyaz kontur eklenmez.
- **Görsel dil**: sıcak kağıt tonları, mercan vurgu, serif başlıklar; açık tema.

## Çalıştırma

```bash
npm install
npx expo start
```

Expo Go ile açabilirsin (Skia, kamera, image picker ve manipulator Expo Go'da
mevcut). SDK 58 destekli Expo Go iOS App Store'da yayınlandı; Android'de Play
Store sürümü henüz 57 ise [expo.dev/go](https://expo.dev/go) üzerinden SDK 58
APK'sını kurabilir veya bir development build kullanabilirsin. Native
yapılandırma değişiklikleri (izin metinleri, splash) için:

```bash
npx expo run:android
# veya
npx expo run:ios
```

Faydalı komutlar:

```bash
npx tsc --noEmit     # tip kontrolü
npx expo lint        # lint
npx expo-doctor      # bağımlılık / yapılandırma kontrolü
```

## OTA güncellemeleri (EAS Update)

`expo-updates` kuruldu ve EAS Update yapılandırıldı:

- `updates.url`: `https://u.expo.dev/22b43827-b10e-43e5-b5ad-4eb2898bf88a`
- `runtimeVersion`: `appVersion` (şu an `1.1.0`)
- Güncelleme kanalı: `production`
- `checkAutomatically`: `ON_LOAD`

JS/asset değişikliklerini yeni APK çıkarmadan yayınlamak için:

```bash
npx eas-cli@latest update \
  --channel production \
  --platform android \
  --environment production \
  -m "Kısa açıklama"
```

Kurulu release APK aynı `runtimeVersion` ile yayınlanan güncellemeyi açılışta
indirir; uygulamayı iki kez kapatıp açınca yeni sürüm etkin olur. Expo Go ve
development build normalde OTA akışını test etmez; release APK gerekir.

Native bağımlılık, izin veya SDK değişikliği varsa OTA yetmez: `version` alanını
artırıp yeni APK/AAB build etmek gerekir. `eas update` yalnızca JS ve asset
günceller.

## GitHub Actions

`.github/workflows/build.yml`, `main`/`master` dalına yapılan push'larda:

1. Node 22 + Java 17 kurar, `npm ci` ile bağımlılıkları yükler.
2. `app.json` içindeki sürümü `package.json`'dan, `versionCode`'u GitHub run
   numarasından yazar.
3. `EXPO_TOKEN` varsa **APK build'inden önce** `production` kanalına OTA
   güncellemesi yayınlar.
4. `npx expo prebuild --platform android` çalıştırır ve yalnızca
   `arm64-v8a` ABI'sini bırakır.
5. `arm64-v8a` için release APK üretir.
6. APK'yı workflow artifact'i ve GitHub Release olarak yükler.

GitHub reposuna **`EXPO_TOKEN`** adında bir secret eklenmeli:
[expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens) üzerinden
oluşturulan token, repo → Settings → Secrets and variables → Actions bölümüne
eklenir. Token yoksa build devam eder, yalnızca OTA adımı atlanır.

## Akıllı seçim sağlayıcısı

İki sağlayıcı vardır ve sırayla denenir:

1. **`mediapipe`** (Android, birincil): `modules/smart-cutout` altındaki yerel Expo
   modülü, MediaPipe `tasks-vision` + MagicTouch modeliyle çalışır. Model
   `modules/smart-cutout/android/src/main/assets/interactive_segmentation.task`
   içinde APK ile birlikte gelir (yaklaşık 30 MB), internet gerektirmez.
   Görsel bir kez modele verilir (`prepareAsync`), ardından gelen dokunuş/sürükleme
   vuruşları hızlıca maske üretir (`segmentAsync`). Model güven maskesi, kenarları
   yumuşak bir alfa bandına çevrilerek PNG olarak cache'e yazılır.
2. **`local-region`** (yedek): renk/bağlantı tabanlı flood-fill. iOS'ta ve
   native modül yüklenemediğinde devreye girer.

Yeni bir sağlayıcı eklemek için `src/services/segmentationService.ts` içindeki
`SegmentationProvider` sözleşmesini uygulayıp listeye eklemek yeterlidir:
girdi olarak görsel + pozitif/negatif noktalar alır, görselle aynı boyutta bir
maske PNG'si döndürür.

Model dosyası yenilenmek istenirse
`https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/latest/interactive_segmentation.task`
adresinden indirilip aynı yola konur.

## Dosya haritası

```
src/app/index.tsx            Sticker tepsisi (ana ekran)
src/app/camera.tsx           Kamera + izin akışı
src/app/editor.tsx           Bellekteki bekleyen fotoğrafı ObjectCutter'a köprü
src/app/export.tsx           WhatsApp paketi oluşturma / sticker seçimi
src/components/ObjectCutter.tsx     Lasso / dört köşe / akıllı seçim, kesim, önizleme, kaydetme
src/components/ActionButton.tsx     Ortak buton
src/components/TransparencyPreview.tsx  Damalı zemin önizlemesi
src/services/imageService.ts        EXIF düzeltme + boyut normalizasyonu
src/services/stickerService.ts      Sticker dosyaları + manifest
src/services/whatsappStickerService.ts  512×512 WebP üretimi, paket manifesti, add-pack niyeti
src/services/shareService.ts        Sistem paylaşım menüsü
src/services/photoSession.ts        Kamera/galeri -> editör bellek aktarımı
src/services/skiaImageLoader.ts     Güvenilir Skia görsel yükleme
src/services/smartCutoutService.ts  MediaPipe köprüsü (hazırla / segmentle / kapat)
src/services/segmentationService.ts Sağlayıcı arayüzü, MediaPipe + yerel yedek
modules/smart-cutout/               MediaPipe MagicTouch native modülü (Android)
modules/share-intent/               Android paylaşım hedefi native modülü
src/utils/geometry.ts               contain-fit ve koordinat dönüşümleri
src/utils/lasso.ts                  Worklet uyumlu lasso / çokgen path üretimi
src/utils/stickerImage.ts           Kırpma, sıkı bbox, beyaz kontur
plugins/withWhatsAppStickers.js     WhatsApp ContentProvider'ı manifeste + Kotlin'e ekler
plugins/whatsapp-stickers/StickerContentProvider.kt  Paketleri WhatsApp'a sunan native provider
```

## Sonraki faz

- `utils/binPacker.ts` (MaxRects / Best Short Side Fit, `PADDING = 10`).
- `PAGE_WIDTH = 360`, `PAGE_HEIGHT = 540` damalı kağıt sayfaları.
- Sticker'ı sayfa boyutunun en fazla %30'una normalize ederek otomatik yerleştirme,
  taşınca yeni sayfa açma.
- Tüm sayfayı galeriye PNG olarak aktarma (`expo-media-library`).
