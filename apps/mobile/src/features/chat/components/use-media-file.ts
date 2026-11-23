import { attachmentFileExtension } from "@openbot/contracts/attachment-files";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { useQuery } from "@tanstack/react-query";
import { Directory, File, Paths } from "expo-file-system";
import { useMemo } from "react";
import { create } from "zustand";
import { supportLog } from "@/features/support/model/support-log";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { largeDownloadOf } from "../model/large-files";

const MIME_EXTENSIONS: Record<string, string> = {
  "video/quicktime": "mov",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "text/markdown": "md",
};

let folderCleared = false;

function mediaFolder() {
  const folder = new Directory(Paths.cache, "chat-media");
  if (!folderCleared) {
    folderCleared = true;
    for (const old of [folder, new Directory(Paths.cache, "chat-videos")]) {
      try {
        if (old.exists) old.delete();
      } catch {}
    }
  }
  return folder;
}

const segment = (value: string) => value.replace(/[^\w.-]/gu, "_").replace(/^\.+/u, "_");
const fileName = (name: string) => name.replace(/[/\\\p{Cc}]/gu, "_").replace(/^\.+/u, "_") || "file";

export function mediaFile(serverId: string, attachment: AttachmentSummary) {
  let name = fileName(attachment.name);
  if (!attachmentFileExtension(name))
    name = `${name}.${MIME_EXTENSIONS[attachment.mimeType] ?? attachment.mimeType.split("/")[1] ?? "bin"}`;
  return new File(mediaFolder(), segment(serverId), segment(attachment.id), name);
}

export function messageFileCopy(serverId: string, key: string, name: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193);
  const folder = `message-file-${(hash >>> 0).toString(36)}`;
  return new File(mediaFolder(), segment(serverId), folder, fileName(name));
}

const mediaWrites = new Map<string, Promise<void>>();

export function writeMediaFile(file: File, base64: string): Promise<void> {
  const running = mediaWrites.get(file.uri);
  if (running) return running;
  const write = file.write(base64, { encoding: "base64" }).finally(() => mediaWrites.delete(file.uri));
  mediaWrites.set(file.uri, write);
  return write;
}

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

export function useMediaDownloadedBytes(serverId: string, attachmentId: string) {
  return useDownloadedBytes((state) => state.bytes.get(downloadKey(serverId, attachmentId)) ?? null);
}

export function useMediaDownloads(serverId: string, attachments: readonly AttachmentSummary[]): ReadonlySet<string> {
  const ids = useDownloadedBytes((state) =>
    attachments
      .filter((attachment) => state.bytes.has(downloadKey(serverId, attachment.id)))
      .map((attachment) => attachment.id)
      .join("\n"),
  );
  return useMemo(() => new Set(ids ? ids.split("\n") : []), [ids]);
}

export function useMediaFile(serverId: string, attachment: AttachmentSummary, enabled: boolean) {
  const { downloadAttachment } = useMobileWorkspaceActions();
  return useQuery({
    enabled,
    queryKey: queryKeys.chatMediaFile(serverId, attachment.id),
    queryFn: async () => {
      const file = mediaFile(serverId, attachment);
      if (file.exists && file.size === attachment.size) return file.uri;
      const key = downloadKey(serverId, attachment.id);
      const started = Date.now();
      let arrived: number | null = null;
      try {
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
        file.parentDirectory.create({ intermediates: true, idempotent: true });
        const data = await downloadAttachment(serverId, attachment.id, largeDownloadOf(attachment, file.uri), progress);
        const handedOver = Date.now();
        if (!data.file) await writeMediaFile(file, data.base64);
        const bytesMs = (arrived ?? handedOver) - started;
        supportLog.add(
          "info",
          "connection",
          `Attachment of ${attachment.size} bytes: bytes ${bytesMs} ms, hand-over ${handedOver - (arrived ?? handedOver)} ms, write ${Date.now() - handedOver} ms`,
        );
        return file.uri;
      } finally {
        setDownloadedBytes(key, null);
      }
    },
    retry: false,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });
}
