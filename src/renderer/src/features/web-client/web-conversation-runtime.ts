import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type AttachmentImportEvent, type AttachmentSummary, filePreviewKindForFile } from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { onCleanup } from "solid-js";
import type { ConversationRuntime } from "../conversation/conversation-runtime";
import type { WebWorkspaceRuntime } from "./web-runtime";

export function createWebConversationRuntime(remote: WebWorkspaceRuntime, hostId: () => string): ConversationRuntime {
  const listeners = new Set<(event: AttachmentImportEvent) => void>();
  const urls = new Set<string>();
  let importing: { cancelled: boolean; serverId: string } | undefined;
  async function cancelImportFiles() {
    if (!importing) return;
    importing.cancelled = true;
    try {
      await remote.cancelUpload();
    } catch {
      // The in-flight upload reports transport errors through its import event.
    }
  }
  const unavailable = async (): Promise<never> => {
    throw new Error(currentText().t("webClient.error.desktopOnly"));
  };
  const emit = (event: AttachmentImportEvent) => {
    for (const listener of listeners) listener(event);
  };
  async function download(id: string) {
    const file = await remote.download(id);
    const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    urls.add(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
  }
  onCleanup(() => {
    void cancelImportFiles();
    for (const url of urls) URL.revokeObjectURL(url);
  });
  return {
    agent: {
      discardDraftAttachment: (id) => remote.discard(id),
      downloadAttachments: unavailable,
      editQueuedMessage: unavailable,
      listInstalledSkills: async () => [],
      listMcpServers: async () => [],
      onAttachmentImport(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      openAttachment: ({ attachmentId }) => download(attachmentId),
      openSharedFile: unavailable,
      openWorkspaceFile: unavailable,
      previewSharedFile: unavailable,
      previewWorkspaceFile: unavailable,
      respondToBrowserSecret: remote.respondToBrowserSecret
        ? (input) => remote.respondToBrowserSecret?.(input) ?? Promise.resolve()
        : unavailable,
      setMessageReaction: (input) => remote.react(input),
    },
    browser: {
      capturePreview: remote.browserPreview ?? unavailable,
      closePictureInPicture: async () => {},
      navigate: unavailable,
      onPictureInPictureEvent: () => () => {},
      open: unavailable,
      openPictureInPicture: unavailable,
      reload: unavailable,
      setVisible: async () => {},
    },
    voice: { onModelStatus: () => () => {}, prepareModel: unavailable, transcribe: unavailable },
    async openUrl(value) {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new Error(currentText().t("webClient.error.linkBlocked"));
      window.open(url.href, "_blank", "noopener,noreferrer");
    },
    async previewAttachment(attachment) {
      const file = await remote.download(attachment.id);
      return {
        name: file.name,
        size: attachment.size,
        mimeType: file.mimeType,
        previewKind: filePreviewKindForFile(file.name, file.mimeType),
        bytes: Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0)),
      };
    },
    async importFiles(files) {
      if (importing || files.length === 0) return;
      const serverId = hostId();
      const job = { cancelled: false, serverId };
      importing = job;
      const requestId = crypto.randomUUID();
      emit({ type: "started", serverId, requestId });
      const attachments: AttachmentSummary[] = [];
      try {
        if (files.length > INPUT_LIMITS.attachments)
          throw new Error(currentText().t("webClient.error.attachmentLimit", { limit: INPUT_LIMITS.attachments }));
        for (const file of files) {
          if (job.cancelled || hostId() !== serverId) break;
          attachments.push(await remote.upload(file));
        }
        if (job.cancelled || hostId() !== serverId) {
          if (hostId() === serverId)
            await Promise.allSettled(attachments.map((attachment) => remote.discard(attachment.id)));
          emit({ type: "completed", serverId, requestId, attachments: [] });
          return;
        }
        emit({ type: "completed", serverId, requestId, attachments });
      } catch (error) {
        if (hostId() === serverId)
          await Promise.allSettled(attachments.map((attachment) => remote.discard(attachment.id)));
        if (job.cancelled) {
          emit({ type: "completed", serverId, requestId, attachments: [] });
          return;
        }
        emit({
          type: "error",
          serverId,
          requestId,
          message: error instanceof Error ? error.message : currentText().t("webClient.error.fileTransfer"),
        });
      } finally {
        importing = undefined;
      }
    },
    cancelImportFiles,
  };
}
