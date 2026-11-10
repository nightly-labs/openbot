import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentEvent,
  type AskSideQuestionInput,
  type AttachmentImportEvent,
  type AttachmentSummary,
  decodeSaveSkillSuggestionResult,
  type SaveSkillSuggestionInput,
  STORAGE_CAPABILITY,
  type TeamRealtimeEvent,
  type TestRoutineInput,
} from "@openbot/contracts/ipc";
import { AGENT_FOLDERS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-folders-v1";
import { AGENT_INSTRUCTIONS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-instructions-v1";
import { AGENT_MEMORY_LIMIT_CAPABILITY } from "@openbot/contracts/team-protocol/agent-memory-limit-v1";
import { LIVE_VOICE_CAPABILITY } from "@openbot/contracts/team-protocol/live-voice-v1";
import { ROUTINE_RESULTS_CAPABILITY } from "@openbot/contracts/team-protocol/routine-results-v1";
import {
  decodeRoutineRunCommandResponse,
  ROUTINE_RUN_COMMAND_CAPABILITY,
  ROUTINE_RUN_COMMAND_ROUTES,
} from "@openbot/contracts/team-protocol/routine-run-command-v1";
import { ROUTINES_ONCE_CAPABILITY } from "@openbot/contracts/team-protocol/routines-once-v1";
import { decodeSideQuestionResponse, SIDE_QUESTION_ROUTES } from "@openbot/contracts/team-protocol/side-question-v1";
import { SKILL_LEARNING_ROUTES } from "@openbot/contracts/team-protocol/skill-learning-v1";
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
import type { SkillCatalogCalls } from "../../skills-port";
import type { ConversationRuntime } from "../conversation/conversation-runtime";
import { webEventRoutinesApi } from "../conversation/routine-webhooks-api";
import type { FilesPort } from "../files/files-port";
import {
  webAgentFoldersApi,
  webAgentInstructionsApi,
  webAgentMemoriesApi,
  webAgentMemoryLimit,
  webRoutineResultsCalls,
} from "./web-agent-settings";
import { createWebAttachmentMedia } from "./web-attachment-media";
import { createWebAttachmentFiles, openWebLink } from "./web-attachments";
import { webBrowserProfileCalls } from "./web-browser-profiles";
import { useWebLiveVoice, webLiveVoicePort } from "./web-live-voice";
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
  webhookSenderSecretEnabled?: () => boolean,
  routineRunPlaceEnabled?: () => boolean,
  routinesOnceEnabled?: () => boolean,
): NonNullable<ConversationRuntime["admin"]> {
  // `request()` names the connected host at call time, so a host switch reaches the new host.
  const eventRoutines = webEventRoutinesApi(
    (...args) => request()(...args),
    () => routineRecoveryEnabled?.() === true,
    () => webhookTestsEnabled?.() === true,
    () => webhookSenderSecretEnabled?.() === true,
    () => routineRunPlaceEnabled?.() === true,
    () => routinesOnceEnabled?.() === true,
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
  webhookSenderSecretEnabled?: () => boolean,
  browserProxiesEnabled?: () => boolean,
  routineRunPlaceEnabled?: () => boolean,
  skillLearningEnabled?: () => boolean,
  /** Whether the connected host advertises the capability. */
  hasCapability?: (capability: string) => boolean,
  /** Whether the connected host advertises the capability and this user is its owner or admin. */
  canAdminister?: (capability: string) => boolean,
  /** The storage calls of the connected host, which Server settings > Storage also uses. */
  storageCalls?: () => FilesPort,
  /** The marketplace skills catalog of the account service that serves this page. */
  skillCatalog?: () => SkillCatalogCalls,
): ConversationRuntime {
  const routinesOnceEnabled = () => hasCapability?.(ROUTINES_ONCE_CAPABILITY) === true;
  const webLiveVoice = useWebLiveVoice();
  const listeners = new Set<(event: AttachmentImportEvent) => void>();
  const files = createWebAttachmentFiles(remote, hostId);
  let importing: { cancelled: boolean; serverId: string } | undefined;
  // A new upload cancels the one in flight (`uploadGeneration` in web-runtime.ts), so one import runs
  // at a time. Each chat sends on its own while another chat imports, so a second import fails, as a
  // second upload does on desktop. A queued import would land in the chat that is open when it
  // starts, and the stop button would end the first one.
  let importBusy = false;
  async function runImport<T>(run: () => Promise<T>): Promise<T> {
    importBusy = true;
    try {
      return await run();
    } finally {
      importBusy = false;
    }
  }
  async function cancelImportFiles() {
    cancelGeneration += 1;
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
  // The files and host of each failed import, for Retry, until the composer removes the chip.
  const failedImports = new Map<string, { serverId: string; files: readonly File[] }>();
  // Cancel upload adds one. A pick stops its files that did not start when the value is not the one
  // it saw at its start, so a later pick cannot hide the earlier one from Cancel.
  let cancelGeneration = 0;
  // `started` names the chat on screen, so it comes before any wait. A set over the limit names no
  // files: it has no chips, and the banner says why it failed.
  const announceImport = (requestId: string, serverId: string, files: readonly File[], retryable: boolean) =>
    emit({
      type: "started",
      serverId,
      requestId,
      files: retryable ? files.map((file) => ({ name: file.name, size: file.size })) : [],
    });
  /**
   * Each file is its own import, as on desktop, so a failed file does not drop the others. They go
   * one after another, because the web client uploads one file at a time.
   */
  async function importPick(files: readonly File[]) {
    // The pick belongs to the host on screen now. After a host change, its other files go nowhere.
    const serverId = hostId();
    if (files.length > INPUT_LIMITS.attachments) {
      const requestId = crypto.randomUUID();
      announceImport(requestId, serverId, files, false);
      await runImportFiles(requestId, serverId, files, false);
      return;
    }
    const generation = cancelGeneration;
    const imports = files.map((file) => ({ requestId: crypto.randomUUID(), files: [file] }));
    for (const item of imports) announceImport(item.requestId, serverId, item.files, true);
    for (const item of imports) {
      if (generation !== cancelGeneration || hostId() !== serverId)
        emit({ type: "completed", serverId, requestId: item.requestId, attachments: [] });
      else await runImportFiles(item.requestId, serverId, item.files, true);
    }
  }
  // `uploadFiles` stops when the host is no longer `serverId`, and the import then lands nowhere.
  async function runImportFiles(requestId: string, serverId: string, files: readonly File[], retryable: boolean) {
    failedImports.delete(requestId);
    if (importBusy) {
      if (retryable) failedImports.set(requestId, { serverId, files });
      emit({ type: "error", serverId, requestId, message: currentText().t("error.remote.attachmentBusy") });
      return;
    }
    await runImport(async () => {
      const job = { cancelled: false, serverId };
      importing = job;
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
        if (retryable) failedImports.set(requestId, { serverId, files });
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
  const browserProfiles = adminRequest
    ? webBrowserProfileCalls(adminRequest, onHostEvent, () => browserProxiesEnabled?.() === true)
    : undefined;
  const listLevels = remote.listAgentNotificationLevels;
  const agentMemories = adminRequest
    ? webAgentMemoriesApi(adminRequest, onHostEvent, (capability) => hasCapability?.(capability) === true)
    : undefined;
  const agentFolders = adminRequest ? webAgentFoldersApi(adminRequest) : undefined;
  const agentInstructions = adminRequest ? webAgentInstructionsApi(adminRequest) : undefined;
  const routineResults = adminRequest ? webRoutineResultsCalls(adminRequest) : undefined;
  const agentMemoryLimit = adminRequest ? webAgentMemoryLimit(adminRequest) : undefined;
  const administers = (capability: string) => canAdminister?.(capability) === true;
  return {
    agent: {
      ...messageLinks,
      importAttachmentData: async (data, serverId) => {
        if (importBusy) throw new Error(currentText().t("error.remote.attachmentBusy"));
        return runImport(async () => {
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
        });
      },
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
      retryAttachmentImport(requestId) {
        const failed = failedImports.get(requestId);
        if (!failed) return;
        announceImport(requestId, failed.serverId, failed.files, true);
        void runImportFiles(requestId, failed.serverId, failed.files, true);
      },
      discardAttachmentImport(requestId) {
        failedImports.delete(requestId);
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
    // Any member who can chat with the agent can talk to it, so the request is not limited to an admin.
    get liveVoice() {
      if (!adminRequest || !onHostEvent || hasCapability?.(LIVE_VOICE_CAPABILITY) !== true || !webLiveVoice())
        return undefined;
      return webLiveVoicePort(adminRequest, onHostEvent);
    },
    get skillCatalog() {
      return skillCatalog?.();
    },
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
    // A member who can chat with the agent can press Save; the host checks the level.
    get saveSkillSuggestion() {
      if (!adminRequest || skillLearningEnabled?.() !== true) return undefined;
      return async (input: SaveSkillSuggestionInput) =>
        adminRequest()("POST", SKILL_LEARNING_ROUTES.save, decodeSaveSkillSuggestionResult, {
          agentId: input.agentId,
          messageId: input.messageId,
        });
    },
    agentMemories,
    get agentFolders() {
      return administers(AGENT_FOLDERS_CAPABILITY) ? agentFolders : undefined;
    },
    get agentInstructions() {
      return administers(AGENT_INSTRUCTIONS_CAPABILITY) ? agentInstructions : undefined;
    },
    get routineResultCalls() {
      return administers(ROUTINE_RESULTS_CAPABILITY) ? routineResults : undefined;
    },
    // The command runs in a shell on the host, so the host gives it to an owner or admin only.
    get routineRunCommand() {
      if (!adminRequest || !administers(ROUTINE_RUN_COMMAND_CAPABILITY)) return undefined;
      return async (input: TestRoutineInput) =>
        adminRequest()("POST", ROUTINE_RUN_COMMAND_ROUTES.command, decodeRoutineRunCommandResponse, {
          agentId: input.agentId,
          routineId: input.routineId,
        });
    },
    get agentMemoryLimit() {
      return administers(AGENT_MEMORY_LIMIT_CAPABILITY) ? agentMemoryLimit : undefined;
    },
    // Every member reads the files; the host lets only an owner or admin delete them.
    get storageCalls() {
      return hasCapability?.(STORAGE_CAPABILITY) === true ? storageCalls?.() : undefined;
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
      if (files.length > 0) await importPick(files);
    },
    cancelImportFiles,
    // `request()` names the connected host at call time, so a host switch reaches the new host.
    routines: adminRequest
      ? {
          ...teamAgentRoutinesApi(
            (...args) => adminRequest()(...args),
            () => routineRunPlaceEnabled?.() === true,
            routinesOnceEnabled,
          ),
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
          webhookSenderSecretEnabled,
          routineRunPlaceEnabled,
          routinesOnceEnabled,
        )
      : undefined,
  };
}
