import { type AttachmentSummary, type FilePreview, filePreviewKindForFile } from "@openbot/contracts/ipc";
import { onCleanup } from "solid-js";
import type { WebWorkspaceRuntime } from "./web-runtime";

/**
 * Attachment files in the browser. There is no host file URL here, so a file is read through the
 * host connection: saved as a download, or previewed from its bytes. Object URLs are released when
 * the owner is disposed.
 */
export function createWebAttachmentFiles(remote: Pick<WebWorkspaceRuntime, "download">) {
  const urls = new Set<string>();
  onCleanup(() => {
    for (const url of urls) URL.revokeObjectURL(url);
  });
  return {
    async download(id: string): Promise<void> {
      const file = await remote.download(id);
      const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      urls.add(url);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
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
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("This link cannot be opened.");
  window.open(url.href, "_blank", "noopener,noreferrer");
}
