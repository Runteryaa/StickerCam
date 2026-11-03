const fs = require('node:fs');
const path = require('node:path');

const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const PROVIDER_AUTHORITY_SUFFIX = '.stickercontentprovider';
const PROVIDER_CLASS_NAME = 'StickerContentProvider';
const TEMPLATE_PATH = path.join(__dirname, 'whatsapp-stickers', 'StickerContentProvider.kt');

/**
 * WhatsApp, sticker paketlerini yalnızca uygulamanın kendi ContentProvider'ı
 * üzerinden okuyabilir. Bu eklenti:
 *
 *  - WhatsApp'ın beklediği `com.whatsapp.sticker.READ` izinli provider'ı
 *    AndroidManifest'e ekler,
 *  - paketleri WhatsApp'a sunan Kotlin sınıfını `android/app/src/main/java`
 *    altına yazar.
 *
 * JS tarafı (`src/services/whatsappStickerService.ts`) paket dosyalarını
 * `filesDir/whatsapp-packs/` altına yazar; provider oradan okur.
 */
function withWhatsAppStickers(config) {
  const packageName = config.android && config.android.package;
  if (!packageName) {
    throw new Error(
      '[withWhatsAppStickers] app.json içinde android.package tanımlı olmalı.',
    );
  }

  const authority = `${packageName}${PROVIDER_AUTHORITY_SUFFIX}`;
  const providerName = `${packageName}.${PROVIDER_CLASS_NAME}`;

  config = withAndroidManifest(config, (manifestConfig) => {
    const manifest = manifestConfig.modResults.manifest;

    const application = manifest.application && manifest.application[0];
    if (!application) {
      throw new Error(
        '[withWhatsAppStickers] AndroidManifest.xml içinde <application> bulunamadı.',
      );
    }

    const providers = application.provider || [];
    const existing = providers.find(
      (provider) => provider.$ && provider.$['android:authorities'] === authority,
    );

    const providerAttributes = {
      'android:name': providerName,
      'android:authorities': authority,
      'android:enabled': 'true',
      'android:exported': 'true',
      'android:readPermission': 'com.whatsapp.sticker.READ',
    };

    if (existing) {
      existing.$ = { ...existing.$, ...providerAttributes };
    } else {
      providers.push({ $: providerAttributes });
    }
    application.provider = providers;

    // WhatsApp kurulu mu diye sorgulayabilmek ve niyeti çözebilmek için paket
    // görünürlüğü gerekir (Android 11+).
    if (!manifest.queries) {
      manifest.queries = [{}];
    }
    const queries = manifest.queries[0];
    const queryPackages = queries.package || [];
    for (const whatsappPackage of ['com.whatsapp', 'com.whatsapp.w4b']) {
      const known = queryPackages.some(
        (entry) => entry.$ && entry.$['android:name'] === whatsappPackage,
      );
      if (!known) {
        queryPackages.push({ $: { 'android:name': whatsappPackage } });
      }
    }
    queries.package = queryPackages;
    manifest.queries[0] = queries;

    return manifestConfig;
  });

  config = withDangerousMod(config, [
    'android',
    (modConfig) => {
      const androidRoot = modConfig.modRequest.platformProjectRoot;
      const javaDirectory = path.join(
        androidRoot,
        'app',
        'src',
        'main',
        'java',
        ...packageName.split('.'),
      );
      fs.mkdirSync(javaDirectory, { recursive: true });

      const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
      const source = template
        .replace(/__PACKAGE__/g, packageName)
        .replace(/__AUTHORITY__/g, authority);

      fs.writeFileSync(
        path.join(javaDirectory, `${PROVIDER_CLASS_NAME}.kt`),
        source,
        'utf8',
      );

      return modConfig;
    },
  ]);

  return config;
}

module.exports = withWhatsAppStickers;
