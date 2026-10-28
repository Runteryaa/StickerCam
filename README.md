# StickerCam

Kamera veya galeriden bir fotoğraf seç, istediğin nesnenin etrafını çiz (veya akıllı
seçimle dokun) ve geriye şeffaf, beyaz konturlu bir sticker kalsın. Sticker'lar
cihazda birikir; sonraki fazda damalı kağıt sayfalara otomatik yerleştirilecek.

Expo SDK 58 · React Native 0.88 · Expo Router · TypeScript · Skia · Reanimated

## Uygulama kimliği

- Görünen ad: **StickerCam**
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
- **Akıllı seçim**: dokunulan noktayı sağlayıcı arayüzüne gönderen modüler
  segmentasyon katmanı (`src/services/segmentationService.ts`). Varsayılan olarak
  cihaz üzerinde çalışan, benzer renkli bağlantılı bölgeyi seçen yerel sağlayıcı
  etkindir. İsteğe bağlı olarak uzak HTTP servisi veya demo sağlayıcı kullanılabilir.
- **Kesim**: lasso path'i görsel piksel uzayına taşınır, Skia offscreen surface
  üzerinde kırpılır, tamamen şeffaf kenarlar kırpılır (sıkı bbox), beyaz sticker
  konturu dosyaya işlenir ve PNG olarak kaydedilir.
- **Kalıcılık**: sticker PNG'leri `document/stickers/` altında, metadata
  `stickers/index.json` manifestinde. Önizleme onaylanmadan dosya kalıcı dizine
  taşınmaz; vazgeçilen taslaklar cache'ten silinir.
- **Defter (sticker tepsisi)**: ana ekranda grid, önizleme, silme, canlı sayaç.
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
- `runtimeVersion`: `appVersion` (şu an `1.0.0`)
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
3. Android NDK 27.1'i kurar ve `npx expo prebuild --platform android` çalıştırır.
4. `arm64-v8a` için release APK üretir.
5. `EXPO_TOKEN` varsa `production` kanalına OTA güncellemesi yayınlar.
6. APK'yı workflow artifact'i ve GitHub Release olarak yükler.

GitHub reposuna **`EXPO_TOKEN`** adında bir secret eklenmeli:
[expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens) üzerinden
oluşturulan token, repo → Settings → Secrets and variables → Actions bölümüne
eklenir. Token yoksa build devam eder, yalnızca OTA adımı atlanır.

## Akıllı seçim sağlayıcısı

Varsayılan olarak **yerel otomatik kesim** etkindir: dokunulan noktadan başlayıp
benzer renkli bağlantılı bölgeyi seçer. Tamamen offline çalışır ve Expo Go ile
uyumludur. Düz veya az desenli zeminlerde iyi sonuç verir; karmaşık fotoğraflarda
serbest çizim daha güvenilirdir.

İsteğe bağlı uzak servis için `.env` dosyasına:

```bash
EXPO_PUBLIC_SEGMENTATION_URL=https://ornek.com/segment
```

Sözleşme: `POST multipart/form-data`

| Alan     | Açıklama                              |
| -------- | ------------------------------------- |
| `image`  | Fotoğraf (JPEG)                       |
| `x`, `y` | Dokunulan nokta, görsel pikselinde    |
| `width`  | Görsel genişliği                      |
| `height` | Görsel yüksekliği                     |

Yanıt: `image/png` — şeffaf zeminli kesim. Uygulama sonucu tekrar sıkı bbox'a
kırpıp beyaz konturu ekler.

Servis olmadan akışı denemek için:

```bash
EXPO_PUBLIC_SEGMENTATION_DEMO=1
```

Bu, gerçek bir model değildir; dokunulan noktanın çevresinde elips kesim üretir.

## Dosya haritası

```
src/app/index.tsx            Sticker tepsisi (ana ekran)
src/app/camera.tsx           Kamera + izin akışı
src/app/editor.tsx           Bellekteki bekleyen fotoğrafı ObjectCutter'a köprü
src/components/ObjectCutter.tsx     Lasso / akıllı seçim, kesim, önizleme, kaydetme
src/components/ActionButton.tsx     Ortak buton
src/components/TransparencyPreview.tsx  Damalı zemin önizlemesi
src/services/imageService.ts        EXIF düzeltme + boyut normalizasyonu
src/services/stickerService.ts      Sticker dosyaları + manifest
src/services/photoSession.ts        Kamera/galeri -> editör bellek aktarımı
src/services/skiaImageLoader.ts     Güvenilir Skia görsel yükleme
src/services/segmentationService.ts Sağlayıcı arayüzü, yerel/HTTP/demo sağlayıcı
src/utils/geometry.ts               contain-fit ve koordinat dönüşümleri
src/utils/lasso.ts                  Worklet uyumlu lasso path üretimi
src/utils/stickerImage.ts           Kırpma, sıkı bbox, beyaz kontur
```

## Sonraki faz

- `utils/binPacker.ts` (MaxRects / Best Short Side Fit, `PADDING = 10`).
- `PAGE_WIDTH = 360`, `PAGE_HEIGHT = 540` damalı kağıt sayfaları.
- Sticker'ı sayfa boyutunun en fazla %30'una normalize ederek otomatik yerleştirme,
  taşınca yeni sayfa açma.
- Tüm sayfayı galeriye PNG olarak aktarma (`expo-media-library`).
