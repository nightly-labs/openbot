import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentEvent, AttachmentImportEvent, AttachmentSummary, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import {
  deleteSharedTable,
  installAgentSkill,
  listAgentSkills,
  listMcpServers,
  listSharedTables,
  setAgentSkillEnabled,
  uninstallAgentSkill,
} from "@openbot/team-client/team-admin-requests";
import { listInstalledSkills, type TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { currentText } from "@openbot/ui/text";
import { onCleanup } from "solid-js";
import type { ConversationRuntime } from "../conversation/conversation-runtime";
import { createWebAttachmentFiles, openWebLink } from "./web-attachments";
import type { WebWorkspaceRuntime } from "./web-runtime";

/** The events of the connected host. */
type HostEvents = (listener: (event: AgentEvent | TeamRealtimeEvent) => void) => () => void;

/** Skills and shared tables on the connected host. The host answers only an owner or admin. */
function webHostAdmin(
  request: () => TeamApiRequest,
  onHostEvent?: HostEvents,
): NonNullable<ConversationRuntime["admin"]> {
  return {
    skills: {
      listInstalled: (agentId) => listAgentSkills(request(), agentId),
      install: (input) => installAgentSkill(request(), input),
      uninstall: (input) => uninstallAgentSkill(request(), input),
      setEnabled: (input) => setAgentSkillEnabled(request(), input),
      ...(onHostEvent
        ? {
            onChanged: (listener: (agentId: string) => void) =>
              onHostEvent((event) => {
                if (event.type === "skills-changed") listener(event.agentId);
              }),
          }
        : {}),
    },
    sharedTables: {
      listTables: () => listSharedTables(request()),
      deleteTable: ({ name }) => deleteSharedTable(request(), name),
    },
  };
}

export function createWebConversationRuntime(
  remote: WebWorkspaceRuntime,
  hostId: () => string,
  adminRequest?: () => TeamApiRequest,
  onHostEvent?: HostEvents,
): ConversationRuntime {
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
    throw new Error(currentText().t("webClient.error.desktopOnly"));
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
      editQueuedMessage: async (input, serverId) => {
        // The edit belongs to the host that queued the message. This client talks only to the connected one.
        if (serverId !== hostId()) throw new Error(currentText().t("webClient.error.hostChanged"));
        return remote.editQueue(input);
      },
      // The skills store asks only a host that serves `installed-skills`, and the MCP store only as an admin.
      listInstalledSkills: async (agentId) => (adminRequest ? listInstalledSkills(adminRequest(), agentId) : []),
      listMcpServers: async (serverId) => {
        if (serverId !== hostId()) throw new Error(currentText().t("webClient.error.hostChanged"));
        return adminRequest ? listMcpServers(adminRequest()) : [];
      },
      onAttachmentImport(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      openAttachment: ({ attachmentId }) => files.download(attachmentId),
      // The browser has no app to open a host file in, so it downloads.
      openSharedFile: ({ path }) => files.saveShared(path),
      openWorkspaceFile: ({ agentId, path }) => files.saveWorkspace(agentId, path),
      previewSharedFile: ({ path }) => files.previewShared(path),
      previewWorkspaceFile: ({ agentId, path }) => files.previewWorkspace(agentId, path),
      respondToBrowserSecret: remote.respondToBrowserSecret
        ? (input) => remote.respondToBrowserSecret?.(input) ?? Promise.resolve()
        : unavailable,
      setMessageReaction: (input) => remote.react(input),
    },
    browser: {
      capturePreview: remote.browserPreview ?? unavailable,
      closePictureInPicture: async () => {},
      navigate: (input) => remote.navigateBrowserTab(input),
      onPictureInPictureEvent: () => () => {},
      open: (input) => remote.openBrowserTab(input),
      openPictureInPicture: unavailable,
      reload: (tabId) => remote.reloadBrowserTab(tabId),
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
    admin: adminRequest ? webHostAdmin(adminRequest, onHostEvent) : undefined,
  };
}
