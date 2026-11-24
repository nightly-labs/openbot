import { attachmentFileExtension } from "@openbot/contracts/attachment-files";
import { Platform } from "react-native";

export function shareTypeOptions(uri: string, mimeType: string): { mimeType?: string } {
  return Platform.OS === "ios" && attachmentFileExtension(uri) ? {} : { mimeType };
}
