import { type DraftAttachment, filePreviewKindForFile } from "@openbot/contracts/ipc";
import type { DesktopAnalyticsProperties } from "../../analytics";

type AttachmentKind = NonNullable<DesktopAnalyticsProperties<"message_send">["attachment_kinds"]>[number];

const kinds = new Map<string, AttachmentKind>();

function attachmentKind(attachment: DraftAttachment): AttachmentKind {
  const { name, mimeType } = attachment;
  if (mimeType === "application/zip" || /\.zip$/iu.test(name)) return "zip";
  if (mimeType === "text/csv") return "spreadsheet";
  switch (filePreviewKindForFile(name, mimeType)) {
    case "image":
      return "image";
    case "spreadsheet":
      return "spreadsheet";
    case "pdf":
    case "text":
    case "markdown":
      return "document";
    default:
      return "other";
  }
}

export function rememberAttachmentKinds(attachments: readonly DraftAttachment[]): void {
  for (const attachment of attachments) kinds.set(attachment.id, attachmentKind(attachment));
}

export function takeAttachmentKinds(draftIds: readonly string[]): AttachmentKind[] {
  return draftIds.flatMap((id) => {
    const kind = kinds.get(id);
    kinds.delete(id);
    return kind ? [kind] : [];
  });
}
