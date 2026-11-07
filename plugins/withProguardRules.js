const { withDangerousMod, withGradleProperties } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Release derlemesindeki R8, MediaPipe'ın reflection ile okuduğu proto
 * alanlarını ve statik başlatıcılarını bozuyor:
 *
 *   - "Field runAsync_ for q14 not found"                       (minify açıkken)
 *   - "ExceptionInInitializerError ... no caller found ... v13" (keep kurallarına rağmen)
 *   - "The model buffer should be either a direct ByteBuffer..." (aynı kök neden)
 *
 * Bu sınıfları tek tek korumak kırılgan: MediaPipe'ın JNI + protobuf-lite
 * kombinasyonu R8'in varsayımlarıyla uyuşmuyor. APK boyutu bu projede öncelik
 * olmadığı için release derlemesinde kod küçültmeyi tamamen kapatıyoruz.
 *
 * `app/build.gradle` bu değeri `findProperty` ile okuyor, yani
 * `gradle.properties` içindeki `android.enableMinifyInReleaseBuilds` yeterli.
 */

const MARKER = '# StickerCam: MediaPipe reflection korumasi';

const RULES = [
  MARKER,
  '-keep class com.google.mediapipe.** { *; }',
  '-keep interface com.google.mediapipe.** { *; }',
  '-keepclassmembers class com.google.mediapipe.** { *; }',
  '-dontwarn com.google.mediapipe.**',
  '',
  '-keep class com.google.protobuf.** { *; }',
  '-keep interface com.google.protobuf.** { *; }',
  '-keepclassmembers class com.google.protobuf.** { *; }',
  '-dontwarn com.google.protobuf.**',
  '',
  '-keepclassmembers class * extends com.google.protobuf.GeneratedMessageLite { <fields>; }',
  '-keepclassmembers class * extends com.google.protobuf.GeneratedMessageLite$ExtendableMessage { *; }',
  '-keepclassmembers class * extends com.google.protobuf.GeneratedMessageV3 { <fields>; }',
  '',
  '-keepclasseswithmembernames class * {',
  '    native <methods>;',
  '}',
  '',
].join('\n');

/** Release derlemesinde R8'i kapatır. */
function withMinifyDisabled(config) {
  return withGradleProperties(config, (gradleConfig) => {
    const properties = gradleConfig.modResults;
    const key = 'android.enableMinifyInReleaseBuilds';

    for (let index = properties.length - 1; index >= 0; index -= 1) {
      const entry = properties[index];
      if (entry.type === 'property' && entry.key === key) {
        properties.splice(index, 1);
      }
    }

    properties.push({ type: 'property', key, value: 'false' });
    return gradleConfig;
  });
}

/**
 * Minify kapalı olsa da emniyet kemeri olarak keep kurallarını da yazarız;
 * ileride biri minify'ı açarsa akıllı kesim sessizce bozulmasın.
 */
function withProguardRulesFile(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const file = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app',
        'proguard-rules.pro',
      );

      let contents = '';
      try {
        contents = fs.readFileSync(file, 'utf8');
      } catch {
        contents = '';
      }

      if (contents.includes(MARKER)) {
        return modConfig;
      }

      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${contents.trimEnd()}\n\n${RULES}`, 'utf8');

      return modConfig;
    },
  ]);
}

module.exports = function withProguardRules(config) {
  return withProguardRulesFile(withMinifyDisabled(config));
};
