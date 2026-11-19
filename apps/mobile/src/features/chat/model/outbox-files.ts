import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import type { ChatAttachment } from "../components/use-chat-attachments";
import { type DecodedOutbox, decodePersistedOutbox, type OutboxFile } from "./outbox";
import type { OutboxStorage } from "./outbox-store";

/**
 * The outbox of one account, in the app's documents. `messages.json` holds the list. A write goes to
 * `messages.next.json` first, so a restart during a write finds one complete list.
 */
export function createOutboxFiles(scope: string): OutboxStorage | null {
  if (!FileSystem.documentDirectory) return null;
  const root = `${FileSystem.documentDirectory}outbox/${encodeURIComponent(scope)}/`;
  const list = `${root}messages.json`;
  const next = `${root}messages.next.json`;
  const filesOf = (clientMessageId: string) => {
    if (!/^[a-zA-Z0-9_-]+$/u.test(clientMessageId)) throw new Error("Invalid outbox message id.");
    return `${root}files/${clientMessageId}/`;
  };

  /** The list in `path`, or undefined when the file is missing, or an incomplete next list. */
  async function read(path: string): Promise<DecodedOutbox | undefined> {
    if (!(await FileSystem.getInfoAsync(path)).exists) return undefined;
    const text = await FileSystem.readAsStringAsync(path);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      // A damaged list is kept aside before the next write replaces it.
      return path === list ? { messages: [], dropped: true } : undefined;
    }
    return decodePersistedOutbox(value);
  }

  return {
    load: async () => {
      // A complete next list is newer than the list: the restart came before the move.
      const pending = await read(next);
      if (pending && !pending.dropped) return pending;
      return (await read(list)) ?? null;
    },
    save: async (outbox) => {
      await FileSystem.makeDirectoryAsync(root, { intermediates: true });
      await FileSystem.writeAsStringAsync(next, JSON.stringify(outbox));
      await FileSystem.deleteAsync(list, { idempotent: true });
      await FileSystem.moveAsync({ from: next, to: list });
    },
    keepUnreadable: async () => {
      if (!(await FileSystem.getInfoAsync(list)).exists) return;
      await FileSystem.copyAsync({ from: list, to: `${root}messages.unreadable-${Date.now()}.json` });
    },
    writeFiles: async (clientMessageId, files: readonly ChatAttachment[]) => {
      const directory = filesOf(clientMessageId);
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const stored: OutboxFile[] = [];
      for (const file of files) {
        const extension =
          file.name
            .split(".")
            .at(-1)
            ?.replace(/[^a-zA-Z0-9]/gu, "") || "bin";
        const fileName = `${Crypto.randomUUID()}.${extension}`;
        // A large file stays on disk: the copy does not read it into memory.
        if (file.file) await FileSystem.copyAsync({ from: file.file.ref, to: `${directory}${fileName}` });
        else
          await FileSystem.writeAsStringAsync(`${directory}${fileName}`, file.base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
        stored.push({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          fileName,
          ...(file.dimensions ? { dimensions: file.dimensions } : {}),
        });
      }
      return stored;
    },
    readFile: (clientMessageId, file) =>
      FileSystem.readAsStringAsync(`${filesOf(clientMessageId)}${file.fileName}`, {
        encoding: FileSystem.EncodingType.Base64,
      }),
    fileUri: (clientMessageId, file) => `${filesOf(clientMessageId)}${file.fileName}`,
    removeFiles: (clientMessageId) => FileSystem.deleteAsync(filesOf(clientMessageId), { idempotent: true }),
  };
}
