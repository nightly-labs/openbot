import { type NativeModule, requireOptionalNativeModule } from "expo";

declare class ShareFilesModule extends NativeModule {
  shareAsync(uris: string[], mimeType: string): Promise<void>;
}

export const shareFilesNative = requireOptionalNativeModule<ShareFilesModule>("OpenBotShareFiles");
