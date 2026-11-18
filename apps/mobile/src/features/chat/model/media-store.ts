import { attachmentFileExtension } from "@openbot/contracts/attachment-files";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import type { AttachmentPreviewSize } from "@openbot/contracts/team-protocol/attachment-previews-v1";
import { Directory, File, Paths } from "expo-file-system";

/**
 * The attachments of the hosts, kept on this phone between launches, so a chat and the Library show
 * them at once, also without a connection. A file is at `<server>/<attachment>/`: the original keeps
 * its name, and a smaller copy from the host is `preview-<size>.<jpg|png>`. An attachment id always
 * names the same bytes on its host, so a kept file never becomes stale.
 *
 * `Paths.cache` is `Library/Caches` on iOS: it is not in a device backup, the system encrypts it with
 * the device, and it can delete it when the phone is low on storage. The oldest files go first when
 * the folder uses more than `MAX_BYTES`. Sign-out, the end of a session and the removal of a server
 * delete the files (`deleteAllMedia`, `deleteServerMedia`).
 */
const ROOT = "media-v1";
const MAX_BYTES = 1024 ** 3;
/** The size check waits for a burst of writes to end, so a grid that fills does not list the folder each time. */
const EVICT_DELAY_MS = 5_000;

/** The extension of a file whose name has none, for the types a player cannot read without one. */
const MIME_EXTENSIONS: Record<string, string> = {
  "video/quicktime": "mov",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "text/markdown": "md",
};

/** A folder name from a server or attachment id. */
const segment = (value: string) => value.replace(/[^\w.-]/gu, "_").replace(/^\.+/u, "_");
/** A file name with no folder separators, control characters or leading dots. */
const fileName = (name: string) => name.replace(/[/\\\p{Cc}]/gu, "_").replace(/^\.+/u, "_") || "file";

const attachmentFolder = (serverId: string, attachmentId: string) =>
  new Directory(Paths.cache, ROOT, segment(serverId), segment(attachmentId));

/**
 * Where the original of a host file is kept. A player reads a file, not the Base64 that the host
 * sends, and the file keeps the attachment's name so the share sheet shows it.
 */
export function originalMediaFile(
  serverId: string,
  attachment: Pick<AttachmentSummary, "id" | "name" | "mimeType">,
): File {
  let name = fileName(attachment.name);
  // A player and the photo library read the type from the extension. "preview-" is the start of a copy.
  if (!attachmentFileExtension(name))
    name = `${name}.${MIME_EXTENSIONS[attachment.mimeType] ?? attachment.mimeType.split("/")[1] ?? "bin"}`;
  if (name.startsWith("preview-")) name = `_${name}`;
  return new File(attachmentFolder(serverId, attachment.id), name);
}

const previewFile = (serverId: string, attachmentId: string, size: AttachmentPreviewSize, extension: "jpg" | "png") =>
  new File(attachmentFolder(serverId, attachmentId), `preview-${size}.${extension}`);

/** The kept copy of this size as a `file://` URI, or null. */
export function keptPreview(serverId: string, attachmentId: string, size: AttachmentPreviewSize): string | null {
  try {
    for (const extension of ["jpg", "png"] as const) {
      const file = previewFile(serverId, attachmentId, size, extension);
      if (file.exists && file.size > 0) return file.uri;
    }
  } catch {
    // The copy downloads again.
  }
  return null;
}

/**
 * Keeps a copy that the host sent and returns its `file://` URI. The copy goes to a temporary file
 * first, so a crash during the write never leaves a cut copy under the real name.
 */
export async function keepPreview(
  serverId: string,
  attachmentId: string,
  size: AttachmentPreviewSize,
  data: { mimeType: string; base64: string },
): Promise<string> {
  const file = previewFile(serverId, attachmentId, size, data.mimeType === "image/png" ? "png" : "jpg");
  file.parentDirectory.create({ intermediates: true, idempotent: true });
  const temporary = new File(file.parentDirectory, `${file.name}.tmp`);
  await temporary.write(data.base64, { encoding: "base64" });
  await temporary.move(file, { overwrite: true });
  mediaWritten();
  return file.uri;
}

let evictTimer: ReturnType<typeof setTimeout> | null = null;

/** Starts the size check after a file was added. */
export function mediaWritten(): void {
  if (evictTimer) clearTimeout(evictTimer);
  evictTimer = setTimeout(() => {
    evictTimer = null;
    evict();
  }, EVICT_DELAY_MS);
}

const filesIn = (folder: Directory): File[] =>
  folder.list().flatMap((entry) => (entry instanceof Directory ? filesIn(entry) : [entry]));

/** The oldest files go first when the folder uses more than `MAX_BYTES`. A folder left empty goes too. */
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
  } catch {
    // The next write checks again, and the system clears the cache folder itself when it needs the space.
  }
}

/** Deletes the kept files of a server that this account no longer has. */
export function deleteServerMedia(serverId: string): void {
  try {
    const folder = new Directory(Paths.cache, ROOT, segment(serverId));
    if (folder.exists) folder.delete();
  } catch {
    // The size limit deletes them later.
  }
}

/** Deletes the kept files of all servers, such as on sign-out. */
export function deleteAllMedia(): void {
  try {
    const root = new Directory(Paths.cache, ROOT);
    if (root.exists) root.delete();
  } catch {
    // The size limit deletes them later.
  }
}
