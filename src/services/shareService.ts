import * as Sharing from 'expo-sharing';

/**
 * Bir sticker dosyasını sistem paylaşım menüsüyle diğer uygulamalara gönderir.
 *
 * Instagram, TikTok ve benzeri uygulamalar sticker paketi içe aktarmayı
 * desteklemediği için burada şeffaf PNG paylaşılır; kullanıcı görseli ilgili
 * uygulamanın hikâye/etiket akışında kullanabilir.
 */
export async function shareStickerImage(
  uri: string,
  title = 'Sticker paylaş',
): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Bu cihazda paylaşım menüsü kullanılamıyor.');
  }

  await Sharing.shareAsync(uri, {
    mimeType: 'image/png',
    UTI: 'public.png',
    dialogTitle: title,
  });
}
