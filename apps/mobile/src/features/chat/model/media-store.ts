import { attachmentFileExtension } from "@openbot/contracts/attachment-files";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { Directory, File, Paths } from "expo-file-system";

const ROOT = "media-v1";
const MAX_BYTES = 1024 ** 3;
const EVICT_DELAY_MS = 5_000;

const MIME_EXTENSIONS: Record<string, string> = {
  "video/quicktime": "mov",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "text/markdown": "md",
};

const segment = (value: string) => value.replace(/[^\w.-]/gu, "_").replace(/^\.+/u, "_");
const fileName = (name: string) => name.replace(/[/\\\p{Cc}]/gu, "_").replace(/^\.+/u, "_") || "file";

const attachmentFolder = (serverId: string, attachmentId: string) =>
  new Directory(Paths.cache, ROOT, segment(serverId), segment(attachmentId));

export function originalMediaFile(
  serverId: string,
  attachment: Pick<AttachmentSummary, "id" | "name" | "mimeType">,
): File {
  let name = fileName(attachment.name);
  if (!attachmentFileExtension(name))
    name = `${name}.${MIME_EXTENSIONS[attachment.mimeType] ?? attachment.mimeType.split("/")[1] ?? "bin"}`;
  if (name.startsWith("preview.")) name = `_${name}`;
  return new File(attachmentFolder(serverId, attachment.id), name);
}

const previewFile = (serverId: string, attachmentId: string, extension: "jpg" | "png") =>
  new File(attachmentFolder(serverId, attachmentId), `preview.${extension}`);

export function keptPreview(serverId: string, attachmentId: string): string | null {
  try {
    for (const extension of ["jpg", "png"] as const) {
      const file = previewFile(serverId, attachmentId, extension);
      if (file.exists && file.size > 0) return file.uri;
    }
  } catch {}
  return null;
}

export async function keepPreview(
  serverId: string,
  attachmentId: string,
  data: { mimeType: string; base64: string },
): Promise<string> {
  const file = previewFile(serverId, attachmentId, data.mimeType === "image/png" ? "png" : "jpg");
  file.parentDirectory.create({ intermediates: true, idempotent: true });
  const temporary = new File(file.parentDirectory, `${file.name}.tmp`);
  await temporary.write(data.base64, { encoding: "base64" });
  await temporary.move(file, { overwrite: true });
  mediaWritten();
  return file.uri;
}

let evictTimer: ReturnType<typeof setTimeout> | null = null;

export function mediaWritten(): void {
  if (evictTimer) clearTimeout(evictTimer);
  evictTimer = setTimeout(() => {
    evictTimer = null;
    evict();
  }, EVICT_DELAY_MS);
}

const filesIn = (folder: Directory): File[] =>
  folder.list().flatMap((entry) => (entry instanceof Directory ? filesIn(entry) : [entry]));

function evict(): void {
  try {
    const root = new Directory(Paths.cache, ROOT);
    if (!root.exists) return;
    const files = filesIn(root).sort((a, b) => (a.modificationTime ?? 0) - (b.modificationTime ?? 0));
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files) {
      if (total <= MAX_BYTES) return;
      total -= file.size;
      const folder = file.parentDirectory;
      file.delete();
      if (folder.list().length === 0) folder.delete();
    }
  } catch {}
}

export function deleteServerMedia(serverId: string): void {
  try {
    const folder = new Directory(Paths.cache, ROOT, segment(serverId));
    if (folder.exists) folder.delete();
  } catch {}
}

export function deleteAllMedia(): void {
  try {
    const root = new Directory(Paths.cache, ROOT);
    if (root.exists) root.delete();
  } catch {}
}
