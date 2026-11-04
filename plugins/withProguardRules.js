const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Release derlemesindeki R8, MediaPipe'ın reflection ile okuduğu proto
 * alanlarını yeniden adlandırınca akıllı kesim çalışma anında
 * "Field runAsync_ for q14 not found" hatası veriyor.
 *
 * `modules/smart-cutout/consumer-rules.pro` bu kuralları zaten taşıyor; burada
 * ayrıca uygulama seviyesindeki `app/proguard-rules.pro` dosyasına da ekliyoruz
 * ki kütüphane consumer kuralları herhangi bir nedenle uygulanmazsa da
 * derleme bozulmasın.
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

function withProguardRules(config) {
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
      fs.writeFileSync(
        file,
        `${contents.trimEnd()}\n\n${RULES}`,
        'utf8',
      );

      return modConfig;
    },
  ]);
}

module.exports = withProguardRules;
