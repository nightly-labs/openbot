import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentEvent, AttachmentImportEvent, AttachmentSummary, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { runTeamEffect } from "@openbot/team-client";
import {
  deleteSharedTable,
  installAgentSkill,
  listAgentSkills,
  listMcpServers,
  listSharedTables,
  previewAgentTemplate,
  publishAgentTemplate,
  readAgentSessionSettings,
  resetAgentSessionSetting,
  setAgentSessionSetting,
  setAgentSkillEnabled,
  uninstallAgentSkill,
  unpublishAgentTemplate,
} from "@openbot/team-client/team-admin-requests";
import { listInstalledSkills, type TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { currentText } from "@openbot/ui/text";
import { Effect } from "effect";
import { onCleanup } from "solid-js";
import type { ConversationRuntime } from "../conversation/conversation-runtime";
import { webEventRoutinesApi } from "../conversation/routine-webhooks-api";
import { createWebAttachmentFiles, openWebLink } from "./web-attachments";
import type { WebWorkspaceRuntime } from "./web-runtime";

/** The events of the connected host. */
type HostEvents = (listener: (event: AgentEvent | TeamRealtimeEvent) => void) => () => void;

/** Skills, shared tables and agent share links on the connected host. The host answers only an owner or admin. */
function webHostAdmin(
  request: () => TeamApiRequest,
  onHostEvent?: HostEvents,
  eventsEnabled?: () => boolean,
  sessionSettingsEnabled?: () => boolean,
): NonNullable<ConversationRuntime["admin"]> {
  // `request()` names the connected host at call time, so a host switch reaches the new host.
  const eventRoutines = webEventRoutinesApi((...args) => request()(...args));
  return {
    get sessionSettings() {
      if (sessionSettingsEnabled?.() !== true) return undefined;
      return {
        read: (agentId: string) =>
          runTeamEffect(readAgentSessionSettings(request(), agentId).pipe(Effect.mapError((error) => error.cause))),
        set: (input: import("@openbot/contracts/ipc").SetAgentSessionSettingInput) =>
          runTeamEffect(setAgentSessionSetting(request(), input).pipe(Effect.mapError((error) => error.cause))),
        reset: (input: import("@openbot/contracts/ipc").ResetAgentSessionSettingInput) =>
          runTeamEffect(resetAgentSessionSetting(request(), input).pipe(Effect.mapError((error) => error.cause))),
        ...(onHostEvent
          ? {
              subscribe: (agentId: string, listener: () => void) =>
                onHostEvent((event) => {
                  if (event.type === "agent-session-settings-changed" && event.agentId === agentId) listener();
                }),
            }
          : {}),
      };
    },
    skills: {
      listInstalled: (agentId) =>
        runTeamEffect(listAgentSkills(request(), agentId).pipe(Effect.mapError((error) => error.cause))),
      install: (input) =>
        runTeamEffect(installAgentSkill(request(), input).pipe(Effect.mapError((error) => error.cause))),
      uninstall: (input) =>
        runTeamEffect(uninstallAgentSkill(request(), input).pipe(Effect.mapError((error) => error.cause))),
      setEnabled: (input) =>
        runTeamEffect(setAgentSkillEnabled(request(), input).pipe(Effect.mapError((error) => error.cause))),
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
      listTables: () => runTeamEffect(listSharedTables(request()).pipe(Effect.mapError((error) => error.cause))),
      deleteTable: ({ name }) =>
        runTeamEffect(deleteSharedTable(request(), name).pipe(Effect.mapError((error) => error.cause))),
    },
    agentTemplates: {
      preview: (agentId) =>
        runTeamEffect(previewAgentTemplate(request(), agentId).pipe(Effect.mapError((error) => error.cause))),
      publish: (input) =>
        runTeamEffect(publishAgentTemplate(request(), input).pipe(Effect.mapError((error) => error.cause))),
      unpublish: (agentId) =>
        runTeamEffect(unpublishAgentTemplate(request(), agentId).pipe(Effect.mapError((error) => error.cause))),
    },
    get eventRoutines() {
      return eventsEnabled?.() === false ? undefined : eventRoutines;
    },
  };
}

export function createWebConversationRuntime(
  remote: WebWorkspaceRuntime,
  hostId: () => string,
  adminRequest?: () => TeamApiRequest,
  onHostEvent?: HostEvents,
  eventsEnabled?: () => boolean,
  sessionSettingsEnabled?: () => boolean,
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
      listInstalledSkills: async (agentId) =>
        adminRequest
          ? Effect.runPromise(
              listInstalledSkills(adminRequest(), agentId).pipe(Effect.mapError((error) => error.cause)),
            )
          : [],
      listMcpServers: async (serverId) => {
        if (serverId !== hostId()) throw new Error(currentText().t("webClient.error.hostChanged"));
        return adminRequest
          ? runTeamEffect(listMcpServers(adminRequest()).pipe(Effect.mapError((error) => error.cause)))
          : [];
      },
      listWorkspaceDirectory: ({ agentId, path }) => remote.workspaceDirectory(agentId, path),
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
    admin: adminRequest ? webHostAdmin(adminRequest, onHostEvent, eventsEnabled, sessionSettingsEnabled) : undefined,
  };
}
