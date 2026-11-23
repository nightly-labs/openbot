import { attachmentFileExtension, attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { isChatVisualMimeType } from "@openbot/contracts/chat-visual";
import { type AttachmentSummary, filePreviewKindForFile } from "@openbot/contracts/ipc";
import type { CodePreviewEntry } from "./code-preview-store";

export type AttachmentPreviewKind = Extract<
  CodePreviewEntry["kind"],
  "html" | "markdown" | "text" | "pdf" | "spreadsheet"
>;

export const PREVIEW_PART_CHARACTERS = 200_000;

export function attachmentPreviewKind(
  attachment: Pick<AttachmentSummary, "name" | "mimeType">,
): AttachmentPreviewKind | null {
  if (isChatVisualMimeType(attachment.mimeType)) return "html";
  const mimeType = attachment.mimeType || attachmentMimeTypeForName(attachment.name);
  const kind = filePreviewKindForFile(attachment.name, mimeType);
  return kind === "markdown" || kind === "text" || kind === "pdf" || kind === "spreadsheet" ? kind : null;
}

export function attachmentCodeLanguage(name: string): string {
  return attachmentFileExtension(name) ?? (name.split(/[\\/]/u).at(-1) ?? "").toLowerCase();
}
