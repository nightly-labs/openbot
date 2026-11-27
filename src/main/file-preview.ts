import { readFile, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { isChatVisualMimeType } from "@openbot/contracts/chat-visual";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import { type FilePreview, filePreviewKindForFile } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { attachmentCall } from "../backend/attachment-effects";
import { filePreviewPages } from "./file-preview-pages";

export function mimeTypeForName(name: string) {
  return attachmentMimeTypeForName(name);
}

export function filePreviewFromBytes(name: string, bytes: Uint8Array, generation: number): FilePreview {
  if (bytes.byteLength > ATTACHMENT_LIMITS.fileBytes) throw new Error(sourceText("error.attachment.previewTooLarge"));
  const mimeType = mimeTypeForName(name);
  const kind = filePreviewKindForFile(name, mimeType);
  if (kind === "none") return { name, size: bytes.byteLength, mimeType, previewKind: kind, bytes: null };
  const pageUrl = filePreviewPages.add(mimeType, bytes, generation, undefined, name);
  return { name, size: bytes.byteLength, mimeType, previewKind: kind, bytes, ...(pageUrl ? { pageUrl } : {}) };
}

export const localFilePreview = Effect.fn("FilePreview.local")(function* (
  path: string,
  name: string,
  size: number,
  generation: number,
  maxBytes: number = ATTACHMENT_LIMITS.fileBytes,
) {
  const mimeType = mimeTypeForName(name);
  const kind = size > Math.min(maxBytes, ATTACHMENT_LIMITS.fileBytes) ? "none" : filePreviewKindForFile(name, mimeType);
  const bytes = kind === "none" ? null : new Uint8Array(yield* attachmentCall(() => readFile(path)));
  const folder =
    bytes && isChatVisualMimeType(mimeType)
      ? yield* attachmentCall(() => realpath(dirname(path))).pipe(Effect.orElseSucceed(() => undefined))
      : undefined;
  const pageUrl = bytes ? filePreviewPages.add(mimeType, bytes, generation, folder, name) : undefined;
  return {
    name,
    size,
    mimeType,
    previewKind: kind,
    bytes,
    ...(pageUrl ? { pageUrl } : {}),
  };
});
