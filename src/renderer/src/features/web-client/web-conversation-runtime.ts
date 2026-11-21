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
import {
  decodeFeedbackWithdrawResult,
  FEEDBACK_WITHDRAW_CAPABILITY,
  FEEDBACK_WITHDRAW_ROUTES,
} from "@openbot/contracts/team-protocol/feedback-withdraw-v1";
import { LIVE_VOICE_CAPABILITY } from "@openbot/contracts/team-protocol/live-voice-v1";
import { ROUTINE_PAUSE_REASONS_CAPABILITY } from "@openbot/contracts/team-protocol/routine-pause-reasons-v1";
import { ROUTINE_RESULTS_CAPABILITY } from "@openbot/contracts/team-protocol/routine-results-v1";
import {
  decodeRoutineRunCommandResponse,
  ROUTINE_RUN_COMMAND_CAPABILITY,
  ROUTINE_RUN_COMMAND_ROUTES,
} from "@openbot/contracts/team-protocol/routine-run-command-v1";
import { ROUTINES_ONCE_CAPABILITY } from "@openbot/contracts/team-protocol/routines-once-v1";
import {
  decodeSideQuestionResponse,
  SIDE_QUESTION_ROUTES,
  SIDE_QUESTION_THREADS_CAPABILITY,
} from "@openbot/contracts/team-protocol/side-question-v1";
import { SKILL_LEARNING_ROUTES } from "@openbot/contracts/team-protocol/skill-learning-v1";
import { WEBHOOK_AGENT_SECRET_CAPABILITY } from "@openbot/contracts/team-protocol/webhook-agent-secret-v1";
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
import { openWebMessageLink, webMessageLinks } from "./web-message-link-relay";
import type { WebWorkspaceRuntime } from "./web-runtime";

type HostEvents = (listener: (event: AgentEvent | TeamRealtimeEvent) => void) => () => void;

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
  routinePauseReasonsEnabled?: () => boolean,
  webhookAgentSecretEnabled?: () => boolean,
): NonNullable<ConversationRuntime["admin"]> {
  const eventRoutines = webEventRoutinesApi(
    (...args) => request()(...args),
    () => routineRecoveryEnabled?.() === true,
    () => webhookTestsEnabled?.() === true,
    () => webhookSenderSecretEnabled?.() === true,
    () => routineRunPlaceEnabled?.() === true,
    () => routinesOnceEnabled?.() === true,
    () => routinePauseReasonsEnabled?.() === true,
    () => webhookAgentSecretEnabled?.() === true,
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
  hasCapability?: (capability: string) => boolean,
  canAdminister?: (capability: string) => boolean,
  storageCalls?: () => FilesPort,
  skillCatalog?: () => SkillCatalogCalls,
): ConversationRuntime {
  const routinesOnceEnabled = () => hasCapability?.(ROUTINES_ONCE_CAPABILITY) === true;
  const routinePauseReasonsEnabled = () => hasCapability?.(ROUTINE_PAUSE_REASONS_CAPABILITY) === true;
  const webLiveVoice = useWebLiveVoice();
  const listeners = new Set<(event: AttachmentImportEvent) => void>();
  const attachmentMedia = createWebAttachmentMedia(remote, hostId);
  const files = createWebAttachmentFiles(remote, hostId, attachmentMedia);
  let importing: { cancelled: boolean; serverId: string } | undefined;
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
    } catch {}
  }
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
  const failedImports = new Map<string, { serverId: string; files: readonly File[] }>();
  let cancelGeneration = 0;
  const announceImport = (requestId: string, serverId: string, files: readonly File[], retryable: boolean) =>
    emit({
      type: "started",
      serverId,
      requestId,
      files: retryable ? files.map((file) => ({ name: file.name, size: file.size })) : [],
    });
  async function importPick(files: readonly File[]) {
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
  onCleanup(() => {
    void cancelImportFiles();
    attachmentMedia.dispose();
  });
  const messageLinks = adminRequest
    ? webMessageLinks(adminRequest, () => signInRelayEnabled?.() === true)
    : {
        openMessageLink: async ({ url }: { url: string }) => {
          await openWebMessageLink(url);
          return null;
        },
      };
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
          const job = { cancelled: false, serverId };
          importing = job;
          try {
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
        if (serverId !== hostId()) throw new Error(currentText().t("webClient.error.hostChanged"));
        return remote.editQueue(input);
      },
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
      openSharedFile: ({ path }) => files.saveShared(path),
      openWorkspaceFile: ({ agentId, path }) => files.saveWorkspace(agentId, path),
      previewSharedFile: ({ path }) => files.previewShared(path),
      previewWorkspaceFile: ({ agentId, path, exactPath }) =>
        files.previewWorkspace(agentId, path, exactPath ? { exactPath } : {}),
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
      startTeach: (tabId) => remote.startBrowserTeach(tabId),
      stopTeach: (input) => remote.stopBrowserTeach(input),
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
    get liveVoice() {
      if (!adminRequest || !onHostEvent || hasCapability?.(LIVE_VOICE_CAPABILITY) !== true || !webLiveVoice())
        return undefined;
      return webLiveVoicePort(adminRequest, onHostEvent);
    },
    get skillCatalog() {
      return skillCatalog?.();
    },
    get askSideQuestion() {
      if (!adminRequest || sideQuestionEnabled?.() !== true) return undefined;
      return async (input: AskSideQuestionInput) => {
        if (input.taskId !== undefined && hasCapability?.(SIDE_QUESTION_THREADS_CAPABILITY) !== true)
          throw new Error(currentText().t("error.team.sideQuestionUnsupported"));
        return adminRequest()("POST", SIDE_QUESTION_ROUTES.ask, decodeSideQuestionResponse, {
          agentId: input.agentId,
          question: input.question,
          earlier: input.earlier.map(({ question, answer }) => ({ question, answer })),
          ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
        });
      };
    },
    get sideQuestionThreads() {
      return hasCapability?.(SIDE_QUESTION_THREADS_CAPABILITY) === true;
    },
    get withdrawFeedback() {
      if (!adminRequest || hasCapability?.(FEEDBACK_WITHDRAW_CAPABILITY) !== true) return undefined;
      return async (input: { agentId: string; messageId: string }) =>
        adminRequest()("POST", FEEDBACK_WITHDRAW_ROUTES.withdraw, decodeFeedbackWithdrawResult, {
          agentId: input.agentId,
          messageId: input.messageId,
        });
    },
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
    get storageCalls() {
      return hasCapability?.(STORAGE_CAPABILITY) === true ? storageCalls?.() : undefined;
    },
    agentNotificationLevels: listLevels ? { list: () => listLevels(hostId()) } : undefined,
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
    routines: adminRequest
      ? {
          ...teamAgentRoutinesApi(
            (...args) => adminRequest()(...args),
            () => routineRunPlaceEnabled?.() === true,
            routinesOnceEnabled,
            routinePauseReasonsEnabled,
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
          routinePauseReasonsEnabled,
          () => eventsEnabled?.() === true && hasCapability?.(WEBHOOK_AGENT_SECRET_CAPABILITY) === true,
        )
      : undefined,
  };
}
