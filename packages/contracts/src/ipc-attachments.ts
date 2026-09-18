import { isXlsxMimeType, playableMediaKind } from "./attachment-files";
import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord, isNumber, isOneOf } from "./runtime-values";

export type AttachmentKind = "image" | "file";
export type AttachmentPreviewKind = "image" | "pdf" | "text" | "none";

export interface AttachmentSummary {
  id: string;
  name: string;
  size: number;
  kind: AttachmentKind;
  mimeType: string;
  previewKind: AttachmentPreviewKind;
  previewUrl: string | null;
}

export function isAttachmentSummary(value: unknown): value is AttachmentSummary {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.attachmentName) &&
    isNumber(value.size) &&
    value.size >= 0 &&
    isOneOf(["image", "file"] as const, value.kind) &&
    isBoundedString(value.mimeType, INPUT_LIMITS.mimeType) &&
    isOneOf(["image", "pdf", "text", "none"] as const, value.previewKind) &&
    (value.previewUrl === null || isBoundedString(value.previewUrl, INPUT_LIMITS.avatarUrl))
  );
}

/**
 * Whether a surface can show the attachment itself, instead of opening it in another application.
 * Audio, video, and XLSX keep `previewKind: "none"` on the wire, because the released Team API
 * validators accept only image, pdf, text, and none. Their MIME types carry the local preview kind.
 */
export function canPreviewAttachment(attachment: AttachmentSummary): boolean {
  return (
    attachment.previewKind !== "none" ||
    playableMediaKind(attachment.mimeType) !== null ||
    isXlsxMimeType(attachment.mimeType)
  );
}

export type DraftAttachment = AttachmentSummary;

export interface ChooseAttachmentsInput {
  filter: "all" | "images";
}

export interface AttachmentDataInput {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface ImportAttachmentsInput {
  paths: string[];
  data: AttachmentDataInput[];
}

export type AttachmentImportEvent =
  | { type: "started"; requestId: string; serverId: string }
  | { type: "completed"; requestId: string; serverId: string; attachments: DraftAttachment[] }
  | { type: "error"; requestId: string; serverId: string; message: string };

export interface DownloadAttachmentsInput {
  attachments: { id: string; name: string }[];
}

export interface OpenAttachmentInput {
  attachmentId: string;
  action: "open" | "reveal" | "download";
}

export interface OpenSharedFileInput {
  path: string;
}

export interface OpenWorkspaceFileInput {
  agentId: string;
  path: string;
}

// Wider than AttachmentPreviewKind on purpose: FilePreview never crosses the Team API, so it can
// gain kinds that the frozen v1-v4 attachment validators would reject. The preload boundary decodes
// against this list, so a new kind must be added here to reach the renderer.
export const FILE_PREVIEW_KINDS = [
  "markdown",
  "text",
  "image",
  "pdf",
  "audio",
  "video",
  "spreadsheet",
  "none",
] as const;

export type FilePreviewKind = (typeof FILE_PREVIEW_KINDS)[number];

export function isFilePreviewKind(value: unknown): value is FilePreviewKind {
  return isOneOf(FILE_PREVIEW_KINDS, value);
}

export interface FilePreview {
  name: string;
  size: number;
  mimeType: string;
  previewKind: FilePreviewKind;
  bytes: Uint8Array | null;
}

/**
 * The preview kind a file gets from its name and MIME type. Both sides of the IPC boundary read it:
 * `src/main/file-preview.ts` for a file it reads from disk, and the renderer for an attachment it
 * fetches through `previewUrl`. One function keeps the two from drifting apart.
 */
export function filePreviewKindForFile(name: string, mimeType: string): FilePreviewKind {
  if (/\.(md|markdown)$/iu.test(name)) return "markdown";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (isXlsxMimeType(mimeType)) return "spreadsheet";
  const media = playableMediaKind(mimeType);
  if (media) return media;
  // An email is RFC 822 text. The panel shows the headers and the body without a parser.
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "message/rfc822") return "text";
  return "none";
}
