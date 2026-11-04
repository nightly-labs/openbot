import { sourceText } from "@openbot/i18n/source";
import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { readFileBase64 } from "@/shared/lib/read-file-base64";
import { currentText } from "@/shared/lib/text";

/** The types that a `.zip` file can have. Some apps name it a plain binary file. */
const ZIP_TYPES = ["application/zip", "application/x-zip-compressed", "application/octet-stream"];

/**
 * Reads a picked `.zip` file of up to `maxBytes`, and deletes this phone's copy of it after. The
 * size is checked before the file is read. Null when the user closed the picker.
 */
export async function pickZipUpload(maxBytes: number, tooLarge: string): Promise<RemoteFileUpload | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ZIP_TYPES,
    multiple: false,
    copyToCacheDirectory: true,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  const file = new File(asset.uri);
  try {
    if (!asset.name.toLowerCase().endsWith(".zip") || file.size === 0)
      throw new Error(sourceText("error.import.chooseZip"));
    if (file.size > maxBytes) throw new Error(tooLarge);
    return { name: asset.name, mimeType: "application/zip", base64: await readFileBase64(file) };
  } finally {
    if (file.exists) file.delete();
  }
}

/**
 * Keeps a downloaded transfer file on this phone until `release`, so the share sheet can open it
 * again. The file holds memories and workspace files, so the caller releases it when the screen closes.
 */
export function keepTransferFile(download: RemoteFileUpload): { uri: string; release: () => void } {
  const file = new File(Paths.cache, `${Date.now()}-openbot-transfer.zip`);
  file.writeSync(download.base64, { encoding: "base64" });
  return {
    uri: file.uri,
    release: () => {
      if (file.exists) file.delete();
    },
  };
}

/** Opens the share sheet for a kept transfer file, where the user saves it or sends it to a computer. */
export async function shareTransferFile(uri: string): Promise<void> {
  const { t } = currentText();
  if (!(await Sharing.isAvailableAsync())) throw new Error(t("mobile.server.transfer.sharingUnavailable"));
  await Sharing.shareAsync(uri, {
    mimeType: "application/zip",
    UTI: "public.zip-archive",
    dialogTitle: t("mobile.server.transfer.export"),
  });
}
