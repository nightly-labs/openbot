import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { type AttachmentSummary, type FilePreview, filePreviewKindForFile } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { currentText } from "@openbot/ui/text";

const URL_PREVIEW_KINDS = new Set<FilePreview["previewKind"]>(["image", "pdf", "audio", "video"]);

const attachmentUnavailable = () => sourceText("error.attachment.unavailable");

const LOCAL_ATTACHMENT_URL = /^openbot-attachment:/u;

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
  if (response.status === 404) throw new Error(attachmentUnavailable());
  if (!response.ok) throw new Error(currentText().t("attachment.previewUnavailable"));
  return { ...base, previewKind, bytes: new Uint8Array(await response.arrayBuffer()) };
}

async function assertAttachmentAvailable(url: string): Promise<void> {
  const response = await fetch(url).catch(() => null);
  void response?.body?.cancel();
  if (response?.status === 404) throw new Error(attachmentUnavailable());
}
