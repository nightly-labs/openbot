import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AttachmentImportEvent, AttachmentSummary } from "@openbot/contracts/ipc";
import { onCleanup } from "solid-js";
import type { ConversationRuntime } from "../conversation/conversation-runtime";
import { createWebAttachmentFiles, openWebLink } from "./web-attachments";
import type { WebWorkspaceRuntime } from "./web-runtime";

export function createWebConversationRuntime(remote: WebWorkspaceRuntime, hostId: () => string): ConversationRuntime {
  const listeners = new Set<(event: AttachmentImportEvent) => void>();
  const files = createWebAttachmentFiles(remote);
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
    throw new Error("This action is available in the desktop app.");
  };
  const emit = (event: AttachmentImportEvent) => {
    for (const listener of listeners) listener(event);
  };
  onCleanup(() => {
    void cancelImportFiles();
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
      openAttachment: ({ attachmentId }) => files.download(attachmentId),
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
    openUrl: openWebLink,
    previewAttachment: files.preview,
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
          throw new Error(`A message can have up to ${INPUT_LIMITS.attachments} attachments.`);
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
          message: error instanceof Error ? error.message : "File transfer failed.",
        });
      } finally {
        importing = undefined;
      }
    },
    cancelImportFiles,
  };
}
