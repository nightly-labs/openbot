import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { CHAT_VISUAL_PAGE_LIMIT, isChatVisualMimeType } from "@openbot/contracts/chat-visual";
import { type AttachmentSummary, type FilePreview, filePreviewKindForFile } from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createWebFileSaver } from "./web-file-download";
import type { WebFile, WebWorkspaceRuntime } from "./web-runtime";

/** Visual reply pages kept in memory. The chat list mounts a row again when it scrolls back. */
const VISUAL_PAGE_CACHE = 8;

/**
 * Host files in the browser. There is no host file URL here, so a file is read through the host
 * connection: saved as a download, or previewed from its bytes.
 */
export function createWebAttachmentFiles(
  remote: Pick<WebWorkspaceRuntime, "download" | "sharedFile" | "workspaceFile">,
  hostId: () => string,
) {
  const save = createWebFileSaver();
  const pages = new Map<string, Promise<string>>();
  return {
    async download(id: string): Promise<void> {
      save(await remote.download(id));
    },
    async preview(attachment: AttachmentSummary): Promise<FilePreview> {
      return filePreview(await remote.download(attachment.id));
    },
    /** The HTML of a visual reply page. Only an HTML file that is not too large is a page. */
    visualPage(attachment: AttachmentSummary): Promise<string> {
      const key = `${hostId()}:${attachment.id}`;
      const cached = pages.get(key);
      if (cached) {
        pages.delete(key);
        pages.set(key, cached);
        return cached;
      }
      const page = readVisualPage(remote, attachment);
      pages.set(key, page);
      page.catch(() => pages.delete(key));
      for (const old of pages.keys()) {
        if (pages.size <= VISUAL_PAGE_CACHE) break;
        pages.delete(old);
      }
      return page;
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

async function readVisualPage(
  remote: Pick<WebWorkspaceRuntime, "download">,
  attachment: AttachmentSummary,
): Promise<string> {
  const unavailable = () => new Error(currentText().t("webClient.error.fileTransfer"));
  if (!isChatVisualMimeType(attachment.mimeType) || attachment.size > CHAT_VISUAL_PAGE_LIMIT) throw unavailable();
  const file = filePreview(await remote.download(attachment.id));
  if (!isChatVisualMimeType(file.mimeType) || !file.bytes || file.bytes.byteLength > CHAT_VISUAL_PAGE_LIMIT)
    throw unavailable();
  return new TextDecoder().decode(file.bytes);
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
