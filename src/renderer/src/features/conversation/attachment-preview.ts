import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { type AttachmentSummary, type FilePreview, filePreviewKindForFile } from "@openbot/contracts/ipc";

/** Kinds the panel can render straight from `previewUrl`, without reading the bytes first. */
const URL_PREVIEW_KINDS = new Set<FilePreview["previewKind"]>(["image", "pdf", "audio", "video"]);

/** A deleted file keeps its chat message, and the host answers its URL with 404. */
const ATTACHMENT_UNAVAILABLE = "This file is no longer available.";

/** Only the local host's files are checked: a remote check downloads the whole file first. */
const LOCAL_ATTACHMENT_URL = /^openbot-attachment:/u;

/**
 * Builds the file preview panel's `FilePreview` from an attachment record. `AttachmentSummary`
 * keeps a narrow `previewKind`, because the released Team API v1-v4 validators accept only image,
 * pdf, text, and none. The panel kind is derived from the name and MIME type instead, the same way
 * `src/main/file-preview.ts` derives it for a file on disk.
 *
 * An image, PDF, or media file keeps `bytes: null`: the panel points at `previewUrl` for those, so
 * a 100 MB video is never copied into the renderer to be shown.
 */
export async function attachmentFilePreview(attachment: AttachmentSummary): Promise<FilePreview> {
  const mimeType = attachment.mimeType || attachmentMimeTypeForName(attachment.name);
  const previewKind = filePreviewKindForFile(attachment.name, mimeType);
  const base = { name: attachment.name, size: attachment.size, mimeType };
  if (previewKind === "none" || !attachment.previewUrl) return { ...base, previewKind: "none", bytes: null };
  if (URL_PREVIEW_KINDS.has(previewKind)) {
    if (LOCAL_ATTACHMENT_URL.test(attachment.previewUrl)) await assertAttachmentAvailable(attachment.previewUrl);
    return { ...base, previewKind, bytes: null };
  }
  const response = await fetch(attachment.previewUrl);
  if (response.status === 404) throw new Error(ATTACHMENT_UNAVAILABLE);
  if (!response.ok) throw new Error("Preview is unavailable.");
  return { ...base, previewKind, bytes: new Uint8Array(await response.arrayBuffer()) };
}

/**
 * Stops the panel from opening on a broken image, PDF, or player when the file was deleted. Only a
 * 404 stops it: after any other failure the panel opens as it did before this check.
 */
async function assertAttachmentAvailable(url: string): Promise<void> {
  const response = await fetch(url).catch(() => null);
  void response?.body?.cancel();
  if (response?.status === 404) throw new Error(ATTACHMENT_UNAVAILABLE);
}
