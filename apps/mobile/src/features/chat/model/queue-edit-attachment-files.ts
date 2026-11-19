import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import { currentText } from "@/shared/lib/text";
import type { ChatAttachment } from "../components/use-chat-attachments";
import type { StoredQueueAttachment } from "./queue-edit-draft";

function directory(editId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/u.test(editId)) throw new Error("Invalid queue edit identity.");
  if (!FileSystem.documentDirectory) throw new Error(currentText().t("mobile.chat.queue.storageUnavailable"));
  return `${FileSystem.documentDirectory}queue-edit-attachments/${encodeURIComponent(editId)}/`;
}

export function restoredQueueAttachments(editId: string, files: StoredQueueAttachment[]): ChatAttachment[] {
  return files.map(({ fileName, ...file }) => {
    const uri = `${directory(editId)}${fileName}`;
    return {
      ...file,
      base64: "",
      uri,
      ...(file.size > MOBILE_ATTACHMENT_BYTES ? { file: { ref: uri, size: file.size } } : {}),
    };
  });
}

export async function writeQueueAttachment(editId: string, file: ChatAttachment): Promise<StoredQueueAttachment> {
  const root = directory(editId);
  await FileSystem.makeDirectoryAsync(root, { intermediates: true });
  const fileName = `${Crypto.randomUUID()}.${
    file.name
      .split(".")
      .at(-1)
      ?.replace(/[^a-zA-Z0-9]/gu, "") || "bin"
  }`;
  try {
    if (file.file) await FileSystem.copyAsync({ from: file.file.ref, to: `${root}${fileName}` });
    else
      await FileSystem.writeAsStringAsync(`${root}${fileName}`, file.base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
  } catch (error) {
    await FileSystem.deleteAsync(`${root}${fileName}`, { idempotent: true }).catch(() => {});
    throw error;
  }
  return { id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, fileName };
}

export async function queueAttachmentUpload(
  editId: string,
  stored: StoredQueueAttachment,
  file: ChatAttachment,
): Promise<ChatAttachment> {
  const uri = `${directory(editId)}${stored.fileName}`;
  if (stored.size > MOBILE_ATTACHMENT_BYTES) return { ...file, base64: "", file: { ref: uri, size: stored.size } };
  return { ...file, base64: await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }) };
}

export async function removeQueueAttachment(editId: string, file: StoredQueueAttachment): Promise<void> {
  await FileSystem.deleteAsync(`${directory(editId)}${file.fileName}`, { idempotent: true });
}
