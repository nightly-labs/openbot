import { playableMediaKind } from "./attachment-files";
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
 * Audio and video keep `previewKind: "none"` on the wire, because the released Team API validators
 * accept only image, pdf, text, and none. The MIME type carries the kind instead.
 */
export function canPreviewAttachment(attachment: AttachmentSummary): boolean {
  return attachment.previewKind !== "none" || playableMediaKind(attachment.mimeType) !== null;
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
export const FILE_PREVIEW_KINDS = ["markdown", "text", "image", "pdf", "audio", "video", "none"] as const;

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
