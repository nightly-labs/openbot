import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { type AttachmentSummary, type FilePreview, filePreviewKindForFile } from "@openbot/contracts/ipc";

/** Kinds the panel can render straight from `previewUrl`, without reading the bytes first. */
const URL_PREVIEW_KINDS = new Set<FilePreview["previewKind"]>(["image", "pdf", "audio", "video"]);

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
  if (URL_PREVIEW_KINDS.has(previewKind)) return { ...base, previewKind, bytes: null };
  const response = await fetch(attachment.previewUrl);
  if (!response.ok) throw new Error("Preview is unavailable.");
  return { ...base, previewKind, bytes: new Uint8Array(await response.arrayBuffer()) };
}
