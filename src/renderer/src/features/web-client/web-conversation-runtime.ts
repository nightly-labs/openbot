import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentEvent,
  AskSideQuestionInput,
  AttachmentImportEvent,
  AttachmentSummary,
  TeamRealtimeEvent,
} from "@openbot/contracts/ipc";
import { decodeSideQuestionResponse, SIDE_QUESTION_ROUTES } from "@openbot/contracts/team-protocol/side-question-v1";
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
import { listInstalledSkills, type TeamApiRequest, teamAgentRoutinesApi } from "@openbot/team-client/team-api-requests";
import { currentText } from "@openbot/ui/text";
import { Effect } from "effect";
import { onCleanup } from "solid-js";
import type { ConversationRuntime } from "../conversation/conversation-runtime";
import { webEventRoutinesApi } from "../conversation/routine-webhooks-api";
import { createWebAttachmentMedia } from "./web-attachment-media";
import { createWebAttachmentFiles, openWebLink } from "./web-attachments";
import { webBrowserProfileCalls } from "./web-browser-profiles";
import { webMessageLinks } from "./web-message-link-relay";
import type { WebWorkspaceRuntime } from "./web-runtime";

/** The events of the connected host. */
type HostEvents = (listener: (event: AgentEvent | TeamRealtimeEvent) => void) => () => void;

/** Skills, shared tables and agent share links on the connected host. The host answers only an owner or admin. */
function webHostAdmin(
  request: () => TeamApiRequest,
  onHostEvent?: HostEvents,
  eventsEnabled?: () => boolean,
  sessionSettingsEnabled?: () => boolean,
  routineRecoveryEnabled?: () => boolean,
  webhookTestsEnabled?: () => boolean,
): NonNullable<ConversationRuntime["admin"]> {
  // `request()` names the connected host at call time, so a host switch reaches the new host.
  const eventRoutines = webEventRoutinesApi(
    (...args) => request()(...args),
    () => routineRecoveryEnabled?.() === true,
    () => webhookTestsEnabled?.() === true,
  );
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
  signInRelayEnabled?: () => boolean,
  routineRecoveryEnabled?: () => boolean,
  sideQuestionEnabled?: () => boolean,
  webhookTestsEnabled?: () => boolean,
  browserProfilesEnabled?: () => boolean,
): ConversationRuntime {
  const listeners = new Set<(event: AttachmentImportEvent) => void>();
  const files = createWebAttachmentFiles(remote, hostId);
  let importing: { cancelled: boolean; serverId: string } | undefined;
  // A new upload cancels the one in flight (`uploadGeneration` in web-runtime.ts), so imports run one at a time.
  let uploads: Promise<void> = Promise.resolve();
  function oneAtATime<T>(run: () => Promise<T>): Promise<T> {
    const result = uploads.then(run);
    uploads = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async function cancelImportFiles() {
    if (!importing) return;
    importing.cancelled = true;
    try {
      await remote.cancelUpload();
    } catch {
      // The in-flight upload reports transport errors through its import event.
    }
  }
  // One file at a time, so a stop or host change takes effect before the next upload. On a stop,
  // a host change or a failure, the files already uploaded are discarded if the host is the same.
  async function uploadFiles(
    files: readonly File[],
    serverId: string,
    stopped: () => boolean,
  ): Promise<AttachmentSummary[] | null> {
    const attachments: AttachmentSummary[] = [];
    const discard = async () => {
      if (hostId() === serverId)
        await Promise.allSettled(attachments.map((attachment) => remote.discard(attachment.id)));
    };
    try {
      for (const file of files) {
        if (stopped() || hostId() !== serverId) break;
        attachments.push(await remote.upload(file));
      }
    } catch (error) {
      await discard();
      throw error;
    }
    if (!stopped() && hostId() === serverId) return attachments;
    await discard();
    return null;
  }
  const unavailable = async (): Promise<never> => {
    throw new Error(currentText().t("webClient.error.desktopOnly"));
  };
  const emit = (event: AttachmentImportEvent) => {
    for (const listener of listeners) listener(event);
  };
  const attachmentMedia = createWebAttachmentMedia(remote, hostId);
  onCleanup(() => {
    void cancelImportFiles();
    attachmentMedia.dispose();
  });
  // The host's relay routes are admin only, so only an admin relays a sign-in link.
  const messageLinks = adminRequest ? webMessageLinks(adminRequest, () => signInRelayEnabled?.() === true) : {};
  const browserProfiles = adminRequest ? webBrowserProfileCalls(adminRequest) : undefined;
  const listLevels = remote.listAgentNotificationLevels;
  return {
    agent: {
      ...messageLinks,
      importAttachmentData: (data, serverId) =>
        oneAtATime(async () => {
          if (serverId !== hostId()) throw new Error(currentText().t("webClient.error.hostChanged"));
          const files = data.map((file) => new File([new Uint8Array(file.bytes)], file.name, { type: file.mimeType }));
          // The composer's stop button reaches a paste through `importing`, as it reaches a picked file.
          const job = { cancelled: false, serverId };
          importing = job;
          try {
            // A stop ends the upload in flight with an error. uploadFiles has discarded the files then.
            const attachments = await uploadFiles(files, serverId, () => job.cancelled).catch((error: unknown) => {
              if (job.cancelled) return null;
              throw error;
            });
            if (job.cancelled) return [];
            if (!attachments) throw new Error(currentText().t("webClient.error.hostChanged"));
            return attachments;
          } finally {
            importing = undefined;
          }
        }),
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
      stop: (tabId) => remote.stopBrowserTab(tabId),
      takeControl: (tabId) => remote.takeBrowserControl(tabId),
      releaseControl: (tabId) => remote.releaseBrowserControl(tabId),
      setVisible: async () => {},
    },
    voice: {
      getSettings: unavailable,
      getServer: async () => null,
      onModelStatus: () => () => {},
      prepareModel: unavailable,
      transcribe: unavailable,
      startStream: unavailable,
      appendStream: unavailable,
      finishStream: unavailable,
      cancelStream: async () => {},
      onStreamTranscript: () => () => {},
    },
    openUrl: openWebLink,
    // Any member can ask, so the request is not limited to an admin.
    get askSideQuestion() {
      if (!adminRequest || sideQuestionEnabled?.() !== true) return undefined;
      // Async, so that a host change rejects the promise and the store shows the error.
      return async (input: AskSideQuestionInput) =>
        adminRequest()("POST", SIDE_QUESTION_ROUTES.ask, decodeSideQuestionResponse, {
          agentId: input.agentId,
          question: input.question,
          earlier: input.earlier.map(({ question, answer }) => ({ question, answer })),
        });
    },
    // Any member keeps an own level for each agent. The panel asks only a host with the capability.
    agentNotificationLevels: listLevels ? { list: () => listLevels(hostId()) } : undefined,
    // Any member reads the tab labels; the panels offer the other calls to an owner or admin only.
    get browserProfiles() {
      return browserProfilesEnabled?.() === true ? browserProfiles : undefined;
    },
    previewAttachment: files.preview,
    attachmentMedia,
    visualPage: files.visualPage,
    async importFiles(files) {
      if (files.length === 0) return;
      // A picked or dropped file waits for the upload in flight; it does not start while another one runs.
      await oneAtATime(async () => {
        const serverId = hostId();
        const job = { cancelled: false, serverId };
        importing = job;
        const requestId = crypto.randomUUID();
        emit({ type: "started", serverId, requestId });
        try {
          if (files.length > INPUT_LIMITS.attachments)
            throw new Error(currentText().t("webClient.error.attachmentLimit", { limit: INPUT_LIMITS.attachments }));
          const attachments = await uploadFiles(files, serverId, () => job.cancelled);
          emit({ type: "completed", serverId, requestId, attachments: attachments ?? [] });
        } catch (error) {
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
      });
    },
    cancelImportFiles,
    // `request()` names the connected host at call time, so a host switch reaches the new host.
    routines: adminRequest
      ? {
          ...teamAgentRoutinesApi((...args) => adminRequest()(...args)),
          onEvent: (listener) =>
            onHostEvent?.((event) => {
              if (event.type === "routines-changed") listener(event);
            }) ?? (() => {}),
        }
      : undefined,
    admin: adminRequest
      ? webHostAdmin(
          adminRequest,
          onHostEvent,
          eventsEnabled,
          sessionSettingsEnabled,
          routineRecoveryEnabled,
          webhookTestsEnabled,
        )
      : undefined,
  };
}
