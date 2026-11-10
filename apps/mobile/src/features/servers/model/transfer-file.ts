import { sourceText } from "@openbot/i18n/source";
import { bytesToBase64 } from "@openbot/team-client/base64";
import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { AgentExportFile } from "@/features/workspace/model/workspace-types";
import { readFileBase64 } from "@/shared/lib/read-file-base64";
import { currentText } from "@/shared/lib/text";

/** The types that a `.zip` file can have. Some apps name it a plain binary file. */
const ZIP_TYPES = ["application/zip", "application/x-zip-compressed", "application/octet-stream"];

/** A picked `.zip` file. This phone keeps its copy until `release`, and reads it when it is sent. */
export interface PickedZip extends AgentExportFile {
  release: () => void;
}

/** Picks a `.zip` file without reading it. Null when the user closed the picker. */
export async function pickZipFile(): Promise<PickedZip | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ZIP_TYPES,
    multiple: false,
    copyToCacheDirectory: true,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  const file = new File(asset.uri);
  const release = () => {
    if (file.exists) file.delete();
  };
  if (!asset.name.toLowerCase().endsWith(".zip") || file.size === 0) {
    release();
    throw new Error(sourceText("error.import.chooseZip"));
  }
  return {
    name: asset.name,
    size: file.size,
    readAll: () => readFileBase64(file),
    async readPart(offset, length) {
      const handle = file.open();
      try {
        handle.offset = offset;
        return bytesToBase64(await handle.readBytes(length));
      } finally {
        handle.close();
      }
    },
    release,
  };
}

/**
 * Reads a picked `.zip` file of up to `maxBytes`, and deletes this phone's copy of it after. The
 * size is checked before the file is read. Null when the user closed the picker.
 */
export async function pickZipUpload(maxBytes: number, tooLarge: string): Promise<RemoteFileUpload | null> {
  const picked = await pickZipFile();
  if (!picked) return null;
  try {
    if (picked.size > maxBytes) throw new Error(tooLarge);
    return { name: picked.name, mimeType: "application/zip", base64: await picked.readAll() };
  } finally {
    picked.release();
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
