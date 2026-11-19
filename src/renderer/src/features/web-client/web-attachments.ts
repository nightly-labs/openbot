import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { CHAT_VISUAL_PAGE_LIMIT, isChatVisualMimeType } from "@openbot/contracts/chat-visual";
import { type AttachmentSummary, type FilePreview, filePreviewKindForFile } from "@openbot/contracts/ipc";
import { base64ToBytes } from "@openbot/team-client/base64";
import { currentText } from "@openbot/ui/text";
import type { WebAttachmentMedia } from "./web-attachment-media";
import { createWebFileSaver } from "./web-file-download";
import type { WebFile, WebWorkspaceRuntime } from "./web-runtime";

const VISUAL_PAGE_CACHE = 8;

export function createWebAttachmentFiles(
  remote: Pick<WebWorkspaceRuntime, "download" | "sharedFile" | "workspaceFile">,
  hostId: () => string,
  media: Pick<WebAttachmentMedia, "file" | "keep">,
) {
  const save = createWebFileSaver();
  const pages = new Map<string, Promise<string>>();
  return {
    async download(id: string): Promise<void> {
      const held = await media.file(id);
      save(
        held
          ? { name: held.name, blob: new Blob([held.blob], { type: "application/octet-stream" }) }
          : await remote.download(id),
      );
    },
    async preview(attachment: AttachmentSummary): Promise<FilePreview> {
      const held = await media.file(attachment.id);
      if (held) {
        const bytes = new Uint8Array(await held.blob.arrayBuffer());
        return previewOf(attachment.name, attachment.mimeType || held.blob.type, bytes);
      }
      const file = await remote.download(attachment.id);
      const bytes = base64ToBytes(file.base64);
      media.keep(attachment, bytes);
      return previewOf(file.name, file.mimeType, bytes);
    },
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
  return previewOf(file.name, file.mimeType, base64ToBytes(file.base64));
}

function previewOf(name: string, mimeType: string, bytes: Uint8Array<ArrayBuffer>): FilePreview {
  return {
    name,
    size: bytes.byteLength,
    mimeType,
    previewKind: filePreviewKindForFile(name, mimeType),
    bytes,
  };
}

export async function openWebLink(value: string): Promise<void> {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error(currentText().t("webClient.error.linkBlocked"));
  window.open(url.href, "_blank", "noopener,noreferrer");
}
