import { attachmentFileExtension } from "@openbot/contracts/attachment-files";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { useQuery } from "@tanstack/react-query";
import { Directory, File, Paths } from "expo-file-system";
import { useMemo } from "react";
import { create } from "zustand";
import { supportLog } from "@/features/support/model/support-log";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { isConnectionStop } from "@/features/workspace/model/connection-waits";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileText } from "@/shared/lib/text";
import { largeDownloadOf } from "../model/large-files";

/** The extension of a file whose name has none, for the types a player cannot read without one. */
const MIME_EXTENSIONS: Record<string, string> = {
  "video/quicktime": "mov",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "text/markdown": "md",
};

let folderCleared = false;

/**
 * The folder of downloaded files. A file stays on this phone only for the launch that showed it:
 * the first file of a launch removes the files of the launch before.
 */
function mediaFolder() {
  const folder = new Directory(Paths.cache, "chat-media");
  if (!folderCleared) {
    folderCleared = true;
    // Earlier versions kept videos in their own folder.
    for (const old of [folder, new Directory(Paths.cache, "chat-videos")]) {
      try {
        if (old.exists) old.delete();
      } catch {
        // The system clears the cache folder itself when it needs the space.
      }
    }
  }
  return folder;
}

/** A folder name from a server or attachment id. */
const segment = (value: string) => value.replace(/[^\w.-]/gu, "_").replace(/^\.+/u, "_");
/** A file name with no folder separators, control characters or leading dots. */
const fileName = (name: string) => name.replace(/[/\\\p{Cc}]/gu, "_").replace(/^\.+/u, "_") || "file";

/**
 * Where a host file is kept on this phone. A player reads a file, not the Base64 that the host
 * sends, and the file keeps the attachment's name so the share sheet shows it.
 */
export function mediaFile(serverId: string, attachment: AttachmentSummary) {
  let name = fileName(attachment.name);
  // A player and the photo library read the type from the extension.
  if (!attachmentFileExtension(name))
    name = `${name}.${MIME_EXTENSIONS[attachment.mimeType] ?? attachment.mimeType.split("/")[1] ?? "bin"}`;
  return new File(mediaFolder(), segment(serverId), segment(attachment.id), name);
}

/**
 * The place of a file that a message names, in the folder of downloaded files. `key` names the file
 * on the host, so a second open writes over the copy of the first one and adds no copy.
 */
export function messageFileCopy(serverId: string, key: string, name: string) {
  // FNV-1a: a host path can be longer than a folder name may be.
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193);
  const folder = `message-file-${(hash >>> 0).toString(36)}`;
  return new File(mediaFolder(), segment(serverId), folder, fileName(name));
}

/** The text of a failed download. A download that a lost connection stopped says that it starts again. */
export function mediaFileErrorText(error: Error, text: MobileText): string {
  return isConnectionStop(error) ? text.t("mobile.chat.attachment.downloadStopped") : text.sourceText(error.message);
}

/** The writes that run now, by file. */
const mediaWrites = new Map<string, Promise<void>>();

/**
 * Writes the Base64 of a host file to its place in the folder of downloaded files. The write is not
 * `writeSync`: that decodes and writes megabytes on the JS thread, which also places the chat rows.
 * Two readers of one host file, such as its card and Share, get the same write: a second write to
 * the path would cut the file while the first reader has it.
 */
export function writeMediaFile(file: File, base64: string): Promise<void> {
  const running = mediaWrites.get(file.uri);
  if (running) return running;
  const write = file.write(base64, { encoding: "base64" }).finally(() => mediaWrites.delete(file.uri));
  mediaWrites.set(file.uri, write);
  return write;
}

/** The bytes that have arrived of each host file that downloads now. A file is here from when the host opens it. */
const useDownloadedBytes = create<{ bytes: ReadonlyMap<string, number> }>(() => ({ bytes: new Map() }));

const downloadKey = (serverId: string, attachmentId: string) => `${serverId}\n${attachmentId}`;

function setDownloadedBytes(key: string, received: number | null) {
  useDownloadedBytes.setState(({ bytes }) => {
    const next = new Map(bytes);
    if (received === null) next.delete(key);
    else next.set(key, received);
    return { bytes: next };
  });
}

/** The bytes of a host file that have arrived, or null while it does not download. */
export function useMediaDownloadedBytes(serverId: string, attachmentId: string) {
  return useDownloadedBytes((state) => state.bytes.get(downloadKey(serverId, attachmentId)) ?? null);
}

/** The IDs of the attachments whose card downloads them now. Their file is not on the phone yet. */
export function useMediaDownloads(serverId: string, attachments: readonly AttachmentSummary[]): ReadonlySet<string> {
  // A string, so the component renders again only when the set changes.
  const ids = useDownloadedBytes((state) =>
    attachments
      .filter((attachment) => state.bytes.has(downloadKey(serverId, attachment.id)))
      .map((attachment) => attachment.id)
      .join("\n"),
  );
  return useMemo(() => new Set(ids ? ids.split("\n") : []), [ids]);
}

/**
 * A host file as a local file. A file from an earlier download is used again when it is whole.
 * `enabled` is false while the card passes in a fast fling, or until the user asks for the file.
 */
export function useMediaFile(serverId: string, attachment: AttachmentSummary, enabled: boolean) {
  const { downloadAttachment } = useMobileWorkspaceActions();
  return useQuery({
    enabled,
    queryKey: queryKeys.chatMediaFile(serverId, attachment.id),
    queryFn: async () => {
      const file = mediaFile(serverId, attachment);
      if (file.exists && file.size === attachment.size) return file.uri;
      const key = downloadKey(serverId, attachment.id);
      // The time of each step, in the support log: the bytes, the hand-over from the peer page, the write.
      const started = Date.now();
      let arrived: number | null = null;
      try {
        // An empty file has no progress to show.
        const progress =
          attachment.size > 0
            ? {
                size: attachment.size,
                onProgress: (received: number, total: number) => {
                  if (received >= total) arrived ??= Date.now();
                  setDownloadedBytes(key, received);
                },
              }
            : undefined;
        const data = await downloadAttachment(serverId, attachment.id, largeDownloadOf(attachment), progress);
        const handedOver = Date.now();
        file.parentDirectory.create({ intermediates: true, idempotent: true });
        await writeMediaFile(file, data.base64);
        const bytesMs = (arrived ?? handedOver) - started;
        supportLog.add(
          "info",
          "connection",
          `Attachment of ${attachment.size} bytes: bytes ${bytesMs} ms, hand-over ${handedOver - (arrived ?? handedOver)} ms, write ${Date.now() - handedOver} ms`,
        );
        return file.uri;
      } finally {
        // The query gives the file a moment later; the card keeps its last count until then.
        setDownloadedBytes(key, null);
      }
    },
    retry: false,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });
}
