import { attachmentFileExtension } from "@openbot/contracts/attachment-files";
import { Platform } from "react-native";

/**
 * The type option of `Sharing.shareAsync` for the file at `uri`. On iOS a declared type adds its own
 * extension after the name, and the host gives many files a general type: `report.html` with
 * `text/plain` became `report.html.txt`. iOS reads the type from the extension, so a file that has
 * one is shared by its name. Android keeps the type for the share intent; its name does not change.
 */
export function shareTypeOptions(uri: string, mimeType: string): { mimeType?: string } {
  return Platform.OS === "ios" && attachmentFileExtension(uri) ? {} : { mimeType };
}
