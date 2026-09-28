import { type AttachmentSummary, type FilePreview, filePreviewKindForFile } from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createWebFileSaver } from "./web-file-download";
import type { WebWorkspaceRuntime } from "./web-runtime";

/**
 * Attachment files in the browser. There is no host file URL here, so a file is read through the
 * host connection: saved as a download, or previewed from its bytes.
 */
export function createWebAttachmentFiles(remote: Pick<WebWorkspaceRuntime, "download">) {
  const save = createWebFileSaver();
  return {
    async download(id: string): Promise<void> {
      save(await remote.download(id));
    },
    async preview(attachment: AttachmentSummary): Promise<FilePreview> {
      const file = await remote.download(attachment.id);
      return {
        name: file.name,
        size: attachment.size,
        mimeType: file.mimeType,
        previewKind: filePreviewKindForFile(file.name, file.mimeType),
        bytes: Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0)),
      };
    },
  };
}

/** Opens a link from a message in a new tab. Only web links open; anything else is refused. */
export async function openWebLink(value: string): Promise<void> {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error(currentText().t("webClient.error.linkBlocked"));
  window.open(url.href, "_blank", "noopener,noreferrer");
}
