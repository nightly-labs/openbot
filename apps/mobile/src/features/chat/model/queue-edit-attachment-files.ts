import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import type { ChatAttachment } from "../components/use-chat-attachments";
import type { StoredQueueAttachment } from "./queue-edit-draft";

function directory(editId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/u.test(editId)) throw new Error("Invalid queue edit identity.");
  if (!FileSystem.documentDirectory) throw new Error("Attachment storage is unavailable.");
  return `${FileSystem.documentDirectory}queue-edit-attachments/${encodeURIComponent(editId)}/`;
}

export function restoredQueueAttachments(editId: string, files: StoredQueueAttachment[]): ChatAttachment[] {
  return files.map(({ fileName, ...file }) => ({ ...file, base64: "", uri: `${directory(editId)}${fileName}` }));
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
    await FileSystem.writeAsStringAsync(`${root}${fileName}`, file.base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (error) {
    await FileSystem.deleteAsync(`${root}${fileName}`, { idempotent: true }).catch(() => {});
    throw error;
  }
  return { id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, fileName };
}

export async function readQueueAttachment(editId: string, file: StoredQueueAttachment): Promise<string> {
  return FileSystem.readAsStringAsync(`${directory(editId)}${file.fileName}`, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

export async function removeQueueAttachment(editId: string, file: StoredQueueAttachment): Promise<void> {
  await FileSystem.deleteAsync(`${directory(editId)}${file.fileName}`, { idempotent: true });
}
