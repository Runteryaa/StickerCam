const { withAndroidManifest } = require('expo/config-plugins');

/**
 * StickerCam'i Android paylaşım menüsünde bir hedef haline getirir.
 *
 * Diğer uygulamalarda "Paylaş" seçildiğinde `ACTION_SEND` / `image/*` niyeti
 * StickerCam'e gelir. Görseli karşılayan native taraf
 * `modules/share-intent` altındaki `ShareIntentModule`'dür.
 */
function withShareIntent(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    const manifest = manifestConfig.modResults.manifest;
    const application = manifest.application && manifest.application[0];
    if (!application) {
      throw new Error(
        '[withShareIntent] AndroidManifest.xml içinde <application> bulunamadı.',
      );
    }

    const activities = application.activity || [];
    const mainActivity = activities.find(
      (activity) => activity.$ && (activity.$['android:name'] === '.MainActivity'),
    );

    if (!mainActivity) {
      throw new Error('[withShareIntent] .MainActivity bulunamadı.');
    }

    // Paylaşım mevcut uygulama açıkken gelirse yeni aktivite değil, aynı
    // aktiviteye `onNewIntent` ile düşmesi gerekir.
    mainActivity.$['android:launchMode'] = 'singleTask';

    /** @type {{ $: Record<string, string> }[]} */
    const filters = mainActivity['intent-filter'] || [];

    const hasFilter = (action, mimeType) =>
      filters.some((filter) => {
        const actions = filter.action || [];
        const data = filter.data || [];
        return (
          actions.some((entry) => entry.$ && entry.$['android:name'] === action) &&
          data.some((entry) => entry.$ && entry.$['android:mimeType'] === mimeType)
        );
      });

    const shareFilter = (action) => ({
      action: [{ $: { 'android:name': action } }],
      category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
      data: [{ $: { 'android:mimeType': 'image/*' } }],
    });

    if (!hasFilter('android.intent.action.SEND', 'image/*')) {
      filters.push(shareFilter('android.intent.action.SEND'));
    }
    if (!hasFilter('android.intent.action.SEND_MULTIPLE', 'image/*')) {
      filters.push(shareFilter('android.intent.action.SEND_MULTIPLE'));
    }

    mainActivity['intent-filter'] = filters;

    return manifestConfig;
  });
}

module.exports = withShareIntent;
