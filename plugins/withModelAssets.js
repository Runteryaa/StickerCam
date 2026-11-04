const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * MediaPipe model varlıklarının APK içinde **sıkıştırılmadan** saklanmasını
 * sağlar.
 *
 * `BaseOptions.setModelAssetPath` modeli AssetManager üzerinden dosya tanıtıcısı
 * ile açıyor; APK'da sıkıştırılmış bir asset için bu çağrı
 * "This file can not be opened as a file descriptor; it is probably compressed"
 * hatası verir. `noCompress` yalnızca uygulama modülünde etkili olduğu için
 * kütüphane modülündeki ayar yetmiyor; burada app/build.gradle'a ekliyoruz.
 */
function withModelAssets(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    let contents = gradleConfig.modResults.contents;

    if (contents.includes('noCompress')) {
      return gradleConfig;
    }

    const block = [
      '',
      '    // StickerCam: MediaPipe modeli sıkıştırılmadan paketlenmeli.',
      '    androidResources {',
      "        noCompress += ['task', 'tflite']",
      '    }',
    ].join('\n');

    const anchor = /\nandroid\s*\{/.exec(contents);
    if (!anchor) {
      throw new Error('[withModelAssets] app/build.gradle içinde android bloğu bulunamadı.');
    }

    const insertAt = anchor.index + anchor[0].length;
    contents = `${contents.slice(0, insertAt)}\n${block}${contents.slice(insertAt)}`;
    gradleConfig.modResults.contents = contents;
    return gradleConfig;
  });
}

module.exports = withModelAssets;
