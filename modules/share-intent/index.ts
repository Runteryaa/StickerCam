import { NativeModule, requireOptionalNativeModule } from 'expo';

export type SharedImage = {
  /** Uygulamanın cache dizinine kopyalanmış `file://` uri. */
  uri: string;
  mimeType: string;
  fileName: string;
};

type ShareIntentEvents = {
  /** Yeni bir paylaşım geldiğinde tetiklenir; ardından consume çağrılmalı. */
  onShareReceived: () => void;
};

declare class ShareIntentModule extends NativeModule<ShareIntentEvents> {
  consumeSharedImagesAsync(): Promise<SharedImage[]>;
}

/**
 * iOS'ta bu modül bulunmaz; `null` dönerse paylaşım karşılama sessizce kapalı
 * kalır ve uygulamanın geri kalanı çalışmaya devam eder.
 */
export default requireOptionalNativeModule<ShareIntentModule>('ShareIntent');
