import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { attachmentFileExtension, attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import { type FilePreview, filePreviewKindForFile } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { attachmentCall } from "../backend/attachment-effects";
import { filePreviewPages } from "./file-preview-pages";

export function mimeTypeForName(name: string) {
  return attachmentMimeTypeForName(name);
}

/** A path that is not there: no bytes and no preview, so the chat can say the file is missing. */
export function missingFilePreview(path: string): FilePreview {
  return {
    name: basename(path),
    size: 0,
    mimeType: "application/octet-stream",
    previewKind: "none",
    bytes: null,
    missing: true,
  };
}

export function filePreviewFromBytes(name: string, bytes: Uint8Array): FilePreview {
  if (bytes.byteLength > ATTACHMENT_LIMITS.fileBytes) throw new Error(sourceText("error.attachment.previewTooLarge"));
  const mimeType = mimeTypeForName(name);
  const kind = filePreviewKindForFile(name, mimeType);
  return { name, size: bytes.byteLength, mimeType, previewKind: kind, bytes: kind === "none" ? null : bytes };
}

export const localFilePreview = Effect.fn("FilePreview.local")(function* (
  path: string,
  name: string,
  size: number,
  generation: number,
  maxBytes: number = ATTACHMENT_LIMITS.fileBytes,
) {
  const extension = attachmentFileExtension(name);
  const mimeType = extension === "html" || extension === "htm" ? "text/html" : mimeTypeForName(name);
  // A file over the limit is not read. The panel still opens, reveals and saves it by its path.
  const kind = size > Math.min(maxBytes, ATTACHMENT_LIMITS.fileBytes) ? "none" : filePreviewKindForFile(name, mimeType);
  const bytes = kind === "none" ? null : new Uint8Array(yield* attachmentCall(() => readFile(path)));
  const pageUrl = bytes ? filePreviewPages.add(mimeType, bytes, generation) : undefined;
  const preview: FilePreview = {
    name,
    size,
    mimeType,
    previewKind: kind,
    bytes,
    ...(pageUrl ? { pageUrl } : {}),
  };
  return preview;
});
