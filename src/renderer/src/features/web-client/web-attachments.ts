import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { type AttachmentSummary, type FilePreview, filePreviewKindForFile } from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createWebFileSaver } from "./web-file-download";
import type { WebFile, WebWorkspaceRuntime } from "./web-runtime";

/**
 * Host files in the browser. There is no host file URL here, so a file is read through the host
 * connection: saved as a download, or previewed from its bytes.
 */
export function createWebAttachmentFiles(
  remote: Pick<WebWorkspaceRuntime, "download" | "sharedFile" | "workspaceFile">,
) {
  const save = createWebFileSaver();
  return {
    async download(id: string): Promise<void> {
      save(await remote.download(id));
    },
    async preview(attachment: AttachmentSummary): Promise<FilePreview> {
      return filePreview(await remote.download(attachment.id));
    },
    async saveShared(path: string): Promise<void> {
      save(await remote.sharedFile(path));
    },
    async saveWorkspace(agentId: string, path: string): Promise<void> {
      save(await remote.workspaceFile(agentId, path));
    },
    // The host sends a shared or workspace file as `application/octet-stream`, so its name gives the type.
    async previewShared(path: string): Promise<FilePreview> {
      const file = await remote.sharedFile(path);
      return filePreview({ ...file, mimeType: attachmentMimeTypeForName(file.name) });
    },
    async previewWorkspace(agentId: string, path: string): Promise<FilePreview> {
      const file = await remote.workspaceFile(agentId, path);
      return filePreview({ ...file, mimeType: attachmentMimeTypeForName(file.name) });
    },
  };
}

function filePreview(file: WebFile): FilePreview {
  const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
  return {
    name: file.name,
    size: bytes.byteLength,
    mimeType: file.mimeType,
    previewKind: filePreviewKindForFile(file.name, file.mimeType),
    bytes,
  };
}

/** Opens a link from a message in a new tab. Only web links open; anything else is refused. */
export async function openWebLink(value: string): Promise<void> {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error(currentText().t("webClient.error.linkBlocked"));
  window.open(url.href, "_blank", "noopener,noreferrer");
}
