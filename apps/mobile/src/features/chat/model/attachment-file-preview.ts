import { attachmentFileExtension, attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { isChatVisualMimeType } from "@openbot/contracts/chat-visual";
import { type AttachmentSummary, filePreviewKindForFile } from "@openbot/contracts/ipc";
import type { CodePreviewEntry } from "./code-preview-store";

/** The preview screen kinds that show a whole file. Images, audio and video show in the chat. */
export type AttachmentPreviewKind = Extract<
  CodePreviewEntry["kind"],
  "html" | "markdown" | "text" | "pdf" | "spreadsheet"
>;

/**
 * The characters of a text or Markdown file that the screen shows. The code view is one native
 * text, which a file of many megabytes makes slow to lay out and to highlight.
 */
export const PREVIEW_TEXT_LIMIT = 200_000;

/**
 * How the preview screen shows a file, as desktop decides it in `attachment-preview.ts`: an HTML
 * attachment shows its page, and every other file takes the kind of `filePreviewKindForFile`.
 * Null is a file that has no preview, which opens in the share sheet.
 */
export function attachmentPreviewKind(
  attachment: Pick<AttachmentSummary, "name" | "mimeType">,
): AttachmentPreviewKind | null {
  if (isChatVisualMimeType(attachment.mimeType)) return "html";
  const mimeType = attachment.mimeType || attachmentMimeTypeForName(attachment.name);
  const kind = filePreviewKindForFile(attachment.name, mimeType);
  return kind === "markdown" || kind === "text" || kind === "pdf" || kind === "spreadsheet" ? kind : null;
}

/** The highlight language of a text file, from its extension or its whole name, such as Dockerfile. */
export function attachmentCodeLanguage(name: string): string {
  return attachmentFileExtension(name) ?? (name.split(/[\\/]/u).at(-1) ?? "").toLowerCase();
}
