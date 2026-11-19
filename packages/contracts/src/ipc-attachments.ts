import { isXlsxMimeType, playableMediaKind } from "./attachment-files";
import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { guardedDecoder } from "./ipc-decoding";
import { isBoolean, isDynamicRecord, isNumber, isOneOf } from "./runtime-values";

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
  requestId?: string;
}

export interface AttachmentImportFile {
  name: string;
  size: number;
}

export type AttachmentImportEvent =
  | { type: "started"; requestId: string; serverId: string; files: AttachmentImportFile[] }
  | { type: "progress"; requestId: string; serverId: string; sent: number; total: number }
  | { type: "completed"; requestId: string; serverId: string; attachments: DraftAttachment[] }
  | { type: "error"; requestId: string; serverId: string; message: string };

export interface AttachmentImportProgress {
  serverId: string;
  requestId: string;
  sent: number;
  total: number;
}

export interface DownloadAttachmentsInput {
  attachments: { id: string; name: string }[];
}

export interface OpenAttachmentInput {
  attachmentId: string;
  action: "open" | "reveal" | "download";
  size?: number;
}

export interface AttachmentDownloadProgress {
  serverId: string;
  attachmentId: string;
  received: number;
  total: number;
}

export type FileAction = "open" | "reveal" | "download";

export interface OpenSharedFileInput {
  path: string;
  action?: FileAction;
}

export interface OpenWorkspaceFileInput {
  agentId: string;
  path: string;
  action?: FileAction;
}

export interface PreviewSharedFileInput extends OpenSharedFileInput {
  maxBytes?: number;
}

export interface PreviewWorkspaceFileInput extends OpenWorkspaceFileInput {
  maxBytes?: number;
  exactPath?: boolean;
}

export const WORKSPACE_DIRECTORY_LIMIT = 500;

export interface WorkspaceDirectoryEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number;
  modifiedAt: number;
}

export interface WorkspaceDirectory {
  name: string;
  path: string;
  root: string;
  parentPath: string | null;
  entries: WorkspaceDirectoryEntry[];
  truncated: boolean;
}

const WORKSPACE_DIRECTORY_ENTRY_KINDS = ["file", "directory"] as const;

function isWorkspaceDirectoryEntry(value: unknown): value is WorkspaceDirectoryEntry {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.name, 1_024) &&
    isBoundedString(value.path, INPUT_LIMITS.path) &&
    isOneOf(WORKSPACE_DIRECTORY_ENTRY_KINDS, value.kind) &&
    isNumber(value.size) &&
    isNumber(value.modifiedAt)
  );
}

export function isWorkspaceDirectory(value: unknown): value is WorkspaceDirectory {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.name, 1_024) &&
    isBoundedString(value.path, INPUT_LIMITS.path) &&
    isBoundedString(value.root, INPUT_LIMITS.path) &&
    isNullableBoundedString(value.parentPath, INPUT_LIMITS.path) &&
    Array.isArray(value.entries) &&
    value.entries.length <= WORKSPACE_DIRECTORY_LIMIT &&
    value.entries.every(isWorkspaceDirectoryEntry) &&
    isBoolean(value.truncated)
  );
}

export const decodeWorkspaceDirectory = guardedDecoder(isWorkspaceDirectory, "workspace directory");

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
  pageUrl?: string;
}

export function isFilePreviewPageUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^openbot-visual:\/\/preview\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value)
  );
}

export function filePreviewKindForFile(name: string, mimeType: string): FilePreviewKind {
  if (/\.(md|markdown)$/iu.test(name)) return "markdown";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (isXlsxMimeType(mimeType)) return "spreadsheet";
  const media = playableMediaKind(mimeType);
  if (media) return media;
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "message/rfc822") return "text";
  return "none";
}
