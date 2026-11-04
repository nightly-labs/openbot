import { type NativeModule, requireOptionalNativeModule } from "expo";

declare class ShareFilesModule extends NativeModule {
  /** Opens one share sheet with every file. It resolves when the sheet is on screen or closed. */
  shareAsync(uris: string[], mimeType: string): Promise<void>;
}

/** `modules/share-files`. A build without it, such as Expo Go, cannot share many files at once. */
export const shareFilesNative = requireOptionalNativeModule<ShareFilesModule>("OpenBotShareFiles");
