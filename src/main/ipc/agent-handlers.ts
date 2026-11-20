import { randomUUID } from "node:crypto";
import {
  type AgentTaskInput,
  analyticsQuery,
  assertAnalyticsScope,
  assertHostAnalyticsScope,
  BROWSER_SECRET_RESPONSE_PATH,
  CHANNEL_DELETE_CAPABILITY,
  type ClientAgentSummary,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  decodeAgentFastModels,
  decodeAgentModelListings,
  decodeAgentProfileDraft,
  decodeAgentSteeringModels,
  decodeChannel,
  decodeChannelPage,
  decodeChannelSummaries,
  decodeSaveAgentProfileResult,
  decodeSaveSkillSuggestionResult,
  hostAnalyticsQuery,
  isAgentModelOption,
  LOCAL_SERVER_ID,
  parseAgentAnalyticsInput,
  parseAskSideQuestion,
  parseChannelCommand,
  parseChannelRead,
  parseGenerateAgentProfile,
  parseHostAnalyticsInput,
  parseLocalBrowserSecretResponse,
  parseResetAgentSessionSetting,
  parseSaveAgentProfile,
  parseSaveSkillSuggestion,
  parseSetAgentHiddenInput,
  parseSetAgentNotificationLevelInput,
  parseSetAgentSessionSetting,
  parseSetSidebarPinsInput,
  remoteBrowserSecretResponse,
  type SetSidebarPinsInput,
  type SidebarLayoutAction,
  type SidebarLayoutSnapshot,
  withFastServiceTiers,
  withModelListings,
  withSteeringModels,
  withUsageCredits,
  withWorkspaceOnlyLimit,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  AGENT_ACTIVE_QUEUES_CAPABILITY,
  AGENT_ACTIVE_QUEUES_ROUTES,
  decodeAgentActiveQueues,
} from "@openbot/contracts/team-protocol/agent-active-queues-v1";
import { AGENT_COLORS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-colors-v1";
import { AGENT_CREATE_OPERATION_CAPABILITY } from "@openbot/contracts/team-protocol/agent-create-operation-v1";
import {
  AGENT_FAST_MODE_CAPABILITY,
  AGENT_FAST_MODE_ROUTES,
} from "@openbot/contracts/team-protocol/agent-fast-mode-v1";
import { AGENT_HIDDEN_CAPABILITY, AGENT_HIDDEN_ROUTES } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import {
  AGENT_PENDING_RUNTIME_CAPABILITY,
  AGENT_PENDING_RUNTIME_ROUTES,
  pendingRuntimeUpdateBody,
} from "@openbot/contracts/team-protocol/agent-pending-runtime-v1";
import {
  AGENT_QUEUE_TASK_CAPABILITY,
  AGENT_QUEUE_TASK_ROUTES,
} from "@openbot/contracts/team-protocol/agent-queue-task-v1";
import {
  AGENT_SESSION_SETTINGS_CAPABILITY,
  AGENT_SESSION_SETTINGS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-session-settings-v1";
import { AGENT_SPEED_CAPABILITY, AGENT_SPEED_ROUTES } from "@openbot/contracts/team-protocol/agent-speed-v1";
import { AGENT_TASKS_CAPABILITY, AGENT_TASKS_ROUTES } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import {
  AGENT_THREAD_BRANCHES_CAPABILITY,
  AGENT_THREAD_BRANCHES_ROUTES,
  withAgentThreadBranches,
} from "@openbot/contracts/team-protocol/agent-thread-branches-v1";
import {
  AGENT_THREAD_FILES_CAPABILITY,
  AGENT_THREAD_FILES_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-files-v1";
import {
  AGENT_THREAD_PAGES_CAPABILITY,
  AGENT_THREAD_PAGES_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-pages-v1";
import {
  AGENT_THREAD_QUEUE_CAPABILITY,
  AGENT_THREAD_QUEUE_ROUTES,
  withAgentThreadQueues,
} from "@openbot/contracts/team-protocol/agent-thread-queue-v1";
import {
  AGENT_THREAD_READS_CAPABILITY,
  AGENT_THREAD_READS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-reads-v1";
import {
  AGENT_THREAD_REPLIES_CAPABILITY,
  AGENT_THREAD_REPLIES_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-replies-v1";
import {
  AGENT_THREAD_REQUESTS_CAPABILITY,
  AGENT_THREAD_REQUESTS_ROUTES,
  withAgentThreadRequests,
} from "@openbot/contracts/team-protocol/agent-thread-requests-v1";
import { AGENT_THREADS_CAPABILITY, AGENT_THREADS_ROUTES } from "@openbot/contracts/team-protocol/agent-threads-v1";
import {
  AGENT_USAGE_LIMIT_CAPABILITY,
  AGENT_USAGE_LIMIT_ROUTES,
} from "@openbot/contracts/team-protocol/agent-usage-limit-v1";
import {
  AGENT_WAITS_CAPABILITY,
  AGENT_WAITS_ROUTES,
  decodeAgentWaitsResponse,
} from "@openbot/contracts/team-protocol/agent-waits-v1";
import {
  BROWSER_SECRET_VAULT_CAPABILITY,
  BROWSER_SECRET_VAULT_ROUTES,
} from "@openbot/contracts/team-protocol/browser-secret-vault-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { CHAT_COLORS_CAPABILITY } from "@openbot/contracts/team-protocol/chat-colors-v1";
import { CHAT_HISTORY_CAPABILITY, CHAT_HISTORY_ROUTES } from "@openbot/contracts/team-protocol/chat-history-v1";
import {
  CONTEXT_COMPACT_CAPABILITY,
  CONTEXT_COMPACT_ROUTES,
} from "@openbot/contracts/team-protocol/context-compact-v1";
import { CONTEXT_RESET_CAPABILITY, CONTEXT_RESET_ROUTES } from "@openbot/contracts/team-protocol/context-reset-v1";
import {
  CONVERSATION_FILE_SEARCH_CAPABILITY,
  CONVERSATION_FILE_SEARCH_ROUTES,
  decodeConversationFileSearchResponse,
} from "@openbot/contracts/team-protocol/conversation-file-search-v1";
import {
  CONVERSATION_UNREAD_FROM_CAPABILITY,
  CONVERSATION_UNREAD_FROM_ROUTE,
} from "@openbot/contracts/team-protocol/conversation-unread-from-v1";
import {
  decodeFeedbackWithdrawResult,
  FEEDBACK_WITHDRAW_CAPABILITY,
  FEEDBACK_WITHDRAW_ROUTES,
} from "@openbot/contracts/team-protocol/feedback-withdraw-v1";
import { MESSAGE_DELETE_CAPABILITY, MESSAGE_DELETE_ROUTES } from "@openbot/contracts/team-protocol/message-delete-v1";
import {
  decodeMessagePinsResponse,
  MESSAGE_PINS_CAPABILITY,
  MESSAGE_PINS_ROUTES,
} from "@openbot/contracts/team-protocol/message-pins-v1";
import { MODEL_STEERING_CAPABILITY, MODEL_STEERING_ROUTES } from "@openbot/contracts/team-protocol/model-steering-v1";
import {
  MODEL_VISIBILITY_CAPABILITY,
  MODEL_VISIBILITY_ROUTES,
} from "@openbot/contracts/team-protocol/model-visibility-v1";
import {
  decodePendingApprovalResponse,
  PENDING_APPROVAL_CAPABILITY,
  PENDING_APPROVAL_ROUTES,
} from "@openbot/contracts/team-protocol/pending-approval-v1";
import {
  decodePendingPromptsResponse,
  PENDING_PROMPTS_CAPABILITY,
  PENDING_PROMPTS_ROUTES,
  pendingPromptsWithinLimits,
} from "@openbot/contracts/team-protocol/pending-prompts-v1";
import {
  PROVIDER_ACCOUNTS_CAPABILITY,
  PROVIDER_ACCOUNTS_ROUTES,
} from "@openbot/contracts/team-protocol/provider-accounts-v1";
import {
  decodeSideQuestionResponse,
  SIDE_QUESTION_CAPABILITY,
  SIDE_QUESTION_ROUTES,
} from "@openbot/contracts/team-protocol/side-question-v1";
import {
  SIDEBAR_FOLDERS_CAPABILITY,
  SIDEBAR_FOLDERS_ROUTES,
} from "@openbot/contracts/team-protocol/sidebar-folders-v1";
import { SIDEBAR_PINS_CAPABILITY, SIDEBAR_PINS_ROUTES } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import { SKILL_LEARNING_CAPABILITY, SKILL_LEARNING_ROUTES } from "@openbot/contracts/team-protocol/skill-learning-v1";
import { USAGE_CREDITS_CAPABILITY, USAGE_CREDITS_ROUTES } from "@openbot/contracts/team-protocol/usage-credits-v1";
import { WORKSPACE_ONLY_PROCESS_LIMIT_CAPABILITY } from "@openbot/contracts/team-protocol/workspace-only-process-limit-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { retryOperationIds } from "@openbot/team-client/retry-operation-id";
import { Effect } from "effect";
import { duplicateAgentIntoLayout } from "../../backend/agent/duplication-gate";
import type { AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import { canConfineProcesses } from "../../backend/process-confinement";
import type { SidebarLayoutStore } from "../../backend/sidebar-layout-store";
import type { NotificationChat } from "../desktop-notifications";
import type { HostService } from "../host-service";
import type { LibraryFoldersService } from "../library-folders-service";
import { runMessageDelete } from "../message-delete-refusal";
import { type MessageLinkRelay, openMessageLink } from "../message-link-relay";
import { runMessagePin } from "../message-pin-refusal";
import type { ModelVisibility } from "../model-visibility";
import {
  decodeAccountUsageFromHost,
  decodeAgentAnalyticsFromHost,
  decodeAgentModelOptions,
  decodeAgentSessionSettingsFromHost,
  decodeAgentSummaries,
  decodeAgentSummary,
  decodeHiddenAgentsFromHost,
  decodeHostAnalyticsFromHost,
  decodeInstalledSkillsFromHost,
  decodeQueuedMessageReceipt,
  decodeQueueSnapshot,
  decodeRemoteAgentTask,
  decodeRemoteAgentTasks,
  decodeRemoteAgentThreadBranches,
  decodeRemoteAgentThreadQueues,
  decodeRemoteAgentThreadRequests,
  decodeRemoteTaskConversation,
  decodeRemoteTaskPage,
  decodeRemoteTaskReadState,
  decodeRemoteTaskReadStates,
  decodeRemoteTaskWindow,
  decodeSidebarLayoutSnapshot,
  decodeSidebarPinsFromHost,
  decodeUsageCreditsList,
} from "../remote-agent-decoding";
import { decodeConversationReadState } from "../remote-conversation-decoding";
import { acceptEmpty, decodeVoid, type ResponseDecoder } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import { OWNER_PIN_KEY, type SidebarPinStore } from "../sidebar-pin-store";
import type { SkillMarketplaceService } from "../skill-marketplace-service";
import {
  parseAcknowledgeFailedTurn,
  parseAgentId,
  parseAgentIdList,
  parseAgentTask,
  parseApprovalResponse,
  parseBranchAgentTask,
  parseBrowserTakeoverResponse,
  parseCancelAgentWait,
  parseCancelMessageLink,
  parseCancelQueuedMessage,
  parseChannelId,
  parseCreateAgent,
  parseDeleteChannelMessage,
  parseDeleteConversationMessage,
  parseInterrupt,
  parseMarkAgentTaskRead,
  parseMarkConversationRead,
  parseMarkConversationUnread,
  parseMessageReaction,
  parseOpenMessageLink,
  parseOptionalAgentId,
  parsePasteMessageLink,
  parsePromptResponse,
  parseQueueEdit,
  parseReadAgentTaskAround,
  parseReadAgentTaskPage,
  parseReadConversationPage,
  parseReadPendingApprovalInput,
  parseRenameAgentTask,
  parseReorderQueue,
  parseRunQueuedMessageAsTask,
  parseSearchConversationFiles,
  parseSearchConversationMessages,
  parseSendMessage,
  parseSetAgentAvatar,
  parseSetChannelImage,
  parseSetMessagePinned,
  parseSidebarFolderAction,
  parseStartAgentTask,
  parseSteerQueuedMessage,
  parseUpdateAgent,
  parseUpdateQueuedMessage,
  parseWithdrawFeedback,
} from "./agent-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { readRemoteAgentStatus } from "./remote-agent-status";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

const USAGE_LIMIT_MOVE_FIELDS: ReadonlySet<string> = new Set([
  "agentId",
  "provider",
  "model",
  "reasoningEffort",
  "providerAccountId",
  "leaveUsageLimit",
]);

const modelLogger = createOpenBotLogger("provider-models");
const colorLogger = createOpenBotLogger("agent-colors");
const createOperationId = retryOperationIds(randomUUID);
const accountLogger = createOpenBotLogger("provider-accounts");

function taskRemoteUnsupported(): never {
  throw new Error(sourceText("error.backend.threadRemoteUnsupported"));
}

interface RemoteTaskBody {
  agentId: string;
  taskId?: string;
  text?: string;
  attachmentDraftIds?: string[];
  replyToMessageId?: string;
  clientMessageId?: string;
  deliveryId?: string;
}

function agentTaskBody(input: AgentTaskInput): AgentTaskInput {
  return { agentId: input.agentId, taskId: input.taskId };
}

function logRejectedModels<T>(models: T, source: "local" | "remote"): T {
  if (!Array.isArray(models)) return models;
  for (const model of models) {
    if (isAgentModelOption(model)) continue;
    modelLogger.warn("A model list member fails the contract, so the window refuses the list.", {
      source,
      provider: isDynamicRecord(model) && typeof model.provider === "string" ? model.provider : null,
      id: isDynamicRecord(model) && typeof model.id === "string" ? model.id : null,
    });
  }
  return models;
}

export interface AgentIpcDependencies {
  service: AgentService;
  sidebarLayout: SidebarLayoutStore;
  libraryFolders: Pick<LibraryFoldersService, "removeAgent">;
  sidebarPins: SidebarPinStore;
  host: HostService;
  remoteServers: RemoteServerManager;
  skills: SkillMarketplaceService;
  messageLinks: MessageLinkRelay;
  openExternal: (url: string) => Promise<void>;
  modelVisibility: Pick<ModelVisibility, "picker">;
  closeChatNotifications: (serverId: string, chat: NotificationChat) => void;
}

export function agentIpcHandlers({
  service,
  sidebarLayout,
  libraryFolders,
  sidebarPins,
  host,
  remoteServers,
  skills,
  messageLinks,
  openExternal,
  modelVisibility,
  closeChatNotifications,
}: AgentIpcDependencies): Pick<IpcGroupHandlers, "agent"> {
  const remoteTaskRequest = <T>(serverId: string, path: string, decoder: ResponseDecoder<T>, body: RemoteTaskBody) => {
    if (!remoteServers.supportsCapability(serverId, AGENT_TASKS_CAPABILITY)) taskRemoteUnsupported();
    if (body.attachmentDraftIds?.length && !remoteServers.supportsCapability(serverId, AGENT_THREAD_FILES_CAPABILITY))
      taskRemoteUnsupported();
    if (body.replyToMessageId && !remoteServers.supportsCapability(serverId, AGENT_THREAD_REPLIES_CAPABILITY))
      taskRemoteUnsupported();
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  };
  const saveRemoteSidebarPins = (serverId: string, path: string, body: SetSidebarPinsInput) => {
    if (!remoteServers.supportsCapability(serverId, SIDEBAR_PINS_CAPABILITY))
      throw new Error(sourceText("error.team.sidebarPinsUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decodeSidebarPinsFromHost, { method: "POST", body }));
  };
  const remoteCompact = async (serverId: string, path: string, body: AgentTaskInput | { agentId: string }) => {
    if (!remoteServers.supportsCapability(serverId, CONTEXT_COMPACT_CAPABILITY))
      throw new Error(sourceText("error.team.contextCompactUnsupported"));
    await runCauseEffect(remoteServers.request(serverId, path, acceptEmpty, { method: "POST", body }));
  };
  const remoteChatHistory = async (
    serverId: string,
    path: string,
    body: { agentId: string } | { channelId: string },
    unsupported: "error.team.channelContextUnsupported" | "error.team.historyDeleteUnsupported",
  ) => {
    if (!remoteServers.supportsCapability(serverId, CHAT_HISTORY_CAPABILITY)) throw new Error(sourceText(unsupported));
    await runCauseEffect(remoteServers.request(serverId, path, acceptEmpty, { method: "POST", body }));
  };
  const remoteMessageDelete = async (
    serverId: string,
    path: string,
    body: { agentId: string; taskId?: string; messageId: string } | { channelId: string; messageId: string },
  ) => {
    if (!remoteServers.supportsCapability(serverId, MESSAGE_DELETE_CAPABILITY))
      throw new Error(sourceText("error.backend.messageDeleteUnsupported"));
    await runCauseEffect(remoteServers.request(serverId, path, acceptEmpty, { method: "POST", body }));
  };
  const remoteThreadRequest = (serverId: string, path: string, body: AgentTaskInput & { title?: string }) => {
    if (!remoteServers.supportsCapability(serverId, AGENT_THREADS_CAPABILITY)) taskRemoteUnsupported();
    return runCauseEffect(remoteServers.request(serverId, path, acceptEmpty, { method: "POST", body }));
  };
  const remoteFolderLayout = (serverId: string, body: SidebarLayoutAction | Record<string, never>) =>
    runCauseEffect(
      remoteServers.request(
        serverId,
        "type" in body ? SIDEBAR_FOLDERS_ROUTES.actions : SIDEBAR_FOLDERS_ROUTES.read,
        decodeSidebarLayoutSnapshot,
        { method: "POST", body },
      ),
    );
  const withRemoteFolders = async <T extends { layout: SidebarLayoutSnapshot }>(serverId: string, result: T) =>
    remoteServers.supportsCapability(serverId, SIDEBAR_FOLDERS_CAPABILITY)
      ? { ...result, layout: await remoteFolderLayout(serverId, {}).catch(() => result.layout) }
      : result;
  const withCreatedAgentAccount = async (
    serverId: string,
    agent: ClientAgentSummary,
    accountId: string | undefined,
  ): Promise<ClientAgentSummary> => {
    if (
      accountId === undefined ||
      accountId === DEFAULT_PROVIDER_ACCOUNT_ID ||
      !remoteServers.supportsCapability(serverId, PROVIDER_ACCOUNTS_CAPABILITY)
    )
      return agent;
    try {
      await runCauseEffect(
        remoteServers.request(serverId, PROVIDER_ACCOUNTS_ROUTES.agent, acceptEmpty, {
          method: "POST",
          body: { agentId: agent.id, accountId },
        }),
      );
      return { ...agent, providerAccountId: accountId };
    } catch {
      accountLogger.warn("The account of a new remote agent was not set. The agent uses the provider's own sign-in.");
      return agent;
    }
  };
  return {
    agent: {
      getStatus: scopedQueryHandler({
        local: () => service.getStatus(),
        remote: (serverId) => runCauseEffect(readRemoteAgentStatus(remoteServers, serverId)),
      }),
      getRuntimeSnapshot: scopedQueryHandler({
        local: () => service.getRuntimeSnapshot(),
        remote: async () => {
          await runCauseEffect(remoteServers.refreshRuntimeSnapshots());
          return null;
        },
      }),
      getHostAnalytics: scopedHandler(parseHostAnalyticsInput, {
        local: (input) => service.getHostAnalytics(input),
        remote: (input, serverId) =>
          remoteServers.supportsCapability(serverId, "host-analytics")
            ? runCauseEffect(
                remoteServers.request(serverId, `${TEAM_API_ROUTES.analytics}?${hostAnalyticsQuery(input)}`, (value) =>
                  assertHostAnalyticsScope(decodeHostAnalyticsFromHost(value), input),
                ),
              )
            : null,
      }),
      getAnalytics: scopedHandler(parseAgentAnalyticsInput, {
        local: (input) => service.getAnalytics(input),
        remote: (input, serverId) =>
          remoteServers.supportsCapability(serverId, "agent-analytics")
            ? runCauseEffect(
                remoteServers.request(
                  serverId,
                  `${TEAM_API_ROUTES.agent.analytics(input.agentId)}?${analyticsQuery(input)}`,
                  (value) => assertAnalyticsScope(decodeAgentAnalyticsFromHost(value), input),
                ),
              )
            : null,
      }),
      getUsage: scopedHandler(parseOptionalAgentId, {
        local: (agentId) => runCauseEffect(service.getUsage(agentId)),
        remote: (agentId, serverId) => {
          if (agentId && !remoteServers.supportsCapability(serverId, "model-scoped-usage")) return { limits: [] };
          const usage = remoteServers.request(
            serverId,
            agentId ? TEAM_API_ROUTES.agent.usage(agentId) : TEAM_API_ROUTES.agents.usage,
            decodeAccountUsageFromHost,
          );
          if (!remoteServers.supportsCapability(serverId, USAGE_CREDITS_CAPABILITY)) return runCauseEffect(usage);
          const credits = remoteServers
            .request(serverId, USAGE_CREDITS_ROUTES.list, decodeUsageCreditsList, { method: "POST", body: {} })
            .pipe(Effect.orElseSucceed(() => []));
          return runCauseEffect(
            Effect.all([usage, credits], { concurrency: "unbounded" }).pipe(
              Effect.map(([reading, rows]) => withUsageCredits(reading, rows)),
            ),
          );
        },
      }),
      listModels: scopedQueryHandler({
        local: async () =>
          withWorkspaceOnlyLimit(
            await runCauseEffect(modelVisibility.picker(logRejectedModels(service.listModels(), "local"))),
            !canConfineProcesses(),
          ),
        remote: (serverId) => {
          const models = remoteServers.request(serverId, TEAM_API_ROUTES.agents.models, (value) =>
            decodeAgentModelOptions(logRejectedModels(value, "remote")),
          );
          const fastRoute = remoteServers.supportsCapability(serverId, AGENT_SPEED_CAPABILITY)
            ? AGENT_SPEED_ROUTES.models
            : remoteServers.supportsCapability(serverId, AGENT_FAST_MODE_CAPABILITY)
              ? AGENT_FAST_MODE_ROUTES.models
              : null;
          return runCauseEffect(
            Effect.gen(function* () {
              const fast = fastRoute
                ? remoteServers
                    .request(serverId, fastRoute, decodeAgentFastModels, {
                      method: "POST",
                      body: {},
                    })
                    .pipe(Effect.orElseSucceed(() => []))
                : Effect.succeed([]);
              const listings = remoteServers.supportsCapability(serverId, MODEL_VISIBILITY_CAPABILITY)
                ? remoteServers
                    .request(serverId, MODEL_VISIBILITY_ROUTES.listing, decodeAgentModelListings, {
                      method: "POST",
                      body: {},
                    })
                    .pipe(Effect.orElseSucceed(() => []))
                : Effect.succeed([]);
              const steering = remoteServers.supportsCapability(serverId, MODEL_STEERING_CAPABILITY)
                ? remoteServers
                    .request(serverId, MODEL_STEERING_ROUTES.list, decodeAgentSteeringModels, {
                      method: "POST",
                      body: {},
                    })
                    .pipe(Effect.orElseSucceed(() => []))
                : Effect.succeed([]);
              const [options, fastModels, listed, steered] = yield* Effect.all([models, fast, listings, steering], {
                concurrency: "unbounded",
              });
              return withWorkspaceOnlyLimit(
                withSteeringModels(withModelListings(withFastServiceTiers(options, fastModels), listed), steered),
                remoteServers.supportsCapability(serverId, WORKSPACE_ONLY_PROCESS_LIMIT_CAPABILITY),
              );
            }),
          );
        },
      }),
      readAgentSessionSettings: scopedHandler(parseAgentId, {
        local: (agentId) => runCauseEffect(service.readAgentSessionSettings(agentId)),
        remote: (agentId, serverId) => {
          if (!remoteServers.supportsCapability(serverId, AGENT_SESSION_SETTINGS_CAPABILITY))
            throw new Error(sourceText("error.team.agentSettingsUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, AGENT_SESSION_SETTINGS_ROUTES.read, decodeAgentSessionSettingsFromHost, {
              method: "POST",
              body: { agentId },
            }),
          );
        },
      }),
      setAgentSessionSetting: scopedHandler(parseSetAgentSessionSetting, {
        local: (input) => runCauseEffect(service.setAgentSessionSetting(input)),
        remote: (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, AGENT_SESSION_SETTINGS_CAPABILITY))
            throw new Error(sourceText("error.team.agentSettingsUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, AGENT_SESSION_SETTINGS_ROUTES.set, decodeAgentSessionSettingsFromHost, {
              method: "POST",
              body: input,
            }),
          );
        },
      }),
      resetAgentSessionSetting: scopedHandler(parseResetAgentSessionSetting, {
        local: (input) => runCauseEffect(service.resetAgentSessionSetting(input)),
        remote: (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, AGENT_SESSION_SETTINGS_CAPABILITY))
            throw new Error(sourceText("error.team.agentSettingsUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, AGENT_SESSION_SETTINGS_ROUTES.reset, decodeAgentSessionSettingsFromHost, {
              method: "POST",
              body: input,
            }),
          );
        },
      }),
      listHiddenAgents: scopedQueryHandler({
        local: () => service.listHiddenAgents(),
        remote: (serverId) => {
          if (!remoteServers.supportsCapability(serverId, AGENT_HIDDEN_CAPABILITY)) return { agents: [] };
          return runCauseEffect(
            remoteServers.request(serverId, AGENT_HIDDEN_ROUTES.read, decodeHiddenAgentsFromHost, {
              method: "POST",
              body: {},
            }),
          );
        },
      }),
      setAgentHidden: scopedHandler(parseSetAgentHiddenInput, {
        local: (input) => runCauseEffect(service.setAgentHidden(input)),
        remote: (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, AGENT_HIDDEN_CAPABILITY))
            throw new Error(sourceText("error.team.agentHideUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, AGENT_HIDDEN_ROUTES.set, decodeHiddenAgentsFromHost, {
              method: "POST",
              body: input,
            }),
          );
        },
      }),
      listAgentNotificationLevels: scopedQueryHandler({
        local: () => remoteServers.cachedNotificationLevels(LOCAL_SERVER_ID),
        remote: (serverId) => runCauseEffect(remoteServers.notificationLevels(serverId)),
      }),
      setAgentNotificationLevel: scopedHandler(parseSetAgentNotificationLevelInput, {
        local: (input) => runCauseEffect(remoteServers.setAgentNotificationLevel(LOCAL_SERVER_ID, input)),
        remote: (input, serverId) => runCauseEffect(remoteServers.setAgentNotificationLevel(serverId, input)),
      }),
      listAgents: scopedQueryHandler({
        local: () => service.listAgents(),
        remote: (serverId) =>
          runCauseEffect(
            Effect.all(
              [
                remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries),
                remoteServers.readAgentColors(serverId).pipe(Effect.catch(() => Effect.void)),
                remoteServers.readChatColors(serverId).pipe(Effect.catch(() => Effect.void)),
              ],
              { concurrency: "unbounded" },
            ).pipe(Effect.map(([agents]) => remoteServers.withAgentColors(serverId, agents))),
          ),
      }),
      listInstalledSkills: scopedHandler(parseAgentId, {
        local: (agentId) => runCauseEffect(skills.listInstalledForChatTags(agentId, { problems: true })),
        remote: (agentId, serverId) =>
          remoteServers
            .list()
            .find((server) => server.id === serverId)
            ?.compatibility?.capabilities.includes("installed-skills")
            ? runCauseEffect(
                remoteServers.request(serverId, TEAM_API_ROUTES.agent.skills(agentId), decodeInstalledSkillsFromHost),
              )
            : Promise.resolve([]),
      }),
      listChannels: scopedQueryHandler({
        local: () => service.channels.store.list(host.channelActor().id, true),
        remote: (serverId) =>
          runCauseEffect(remoteServers.request(serverId, CHANNEL_ROUTES.list, decodeChannelSummaries)),
      }),
      readChannel: scopedHandler(parseChannelRead, {
        local: (input) => service.channels.page(input.channelId, input.beforeSequence),
        remote: (input, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, CHANNEL_ROUTES.read, decodeChannelPage, { method: "POST", body: input }),
          ),
      }),
      channelCommand: scopedHandler(parseChannelCommand, {
        local: (input) => {
          if (input.type === "read") closeChatNotifications(LOCAL_SERVER_ID, { channelId: input.channelId });
          return runCauseEffect(service.channels.command(input, host.channelActor()));
        },
        remote: (input, serverId) => {
          if (input.type === "read") closeChatNotifications(serverId, { channelId: input.channelId });
          return runCauseEffect(
            remoteServers.request(serverId, CHANNEL_ROUTES.command, decodeChannel, { method: "POST", body: input }),
          );
        },
      }),
      deleteChannel: scopedHandler(parseChannelId, {
        local: (channelId) => runCauseEffect(service.deleteChannel(channelId)),
        remote: async (channelId, serverId) => {
          if (!remoteServers.supportsCapability(serverId, CHANNEL_DELETE_CAPABILITY))
            throw new Error(sourceText("error.backend.channelDeleteUnsupported"));
          await runCauseEffect(
            remoteServers.request(serverId, CHANNEL_ROUTES.delete, decodeVoid, {
              method: "POST",
              body: { channelId },
            }),
          );
        },
      }),
      deleteChannelMessage: scopedHandler(parseDeleteChannelMessage, {
        local: (input) => runMessageDelete(service.channels.deleteMessage(input, { memberId: null, deleteAny: true })),
        remote: (input, serverId) =>
          remoteMessageDelete(serverId, MESSAGE_DELETE_ROUTES.channel, {
            channelId: input.channelId,
            messageId: input.messageId,
          }),
      }),
      setChannelImage: scopedHandler(parseSetChannelImage, {
        local: (input) => runCauseEffect(service.channels.setImage(input.channelId, input.image)),
        remote: (input, serverId) =>
          runCauseEffect(remoteServers.setChannelImage(input.channelId, input.image, serverId)),
      }),
      clearChannelContext: scopedHandler(parseChannelId, {
        local: (channelId) => runCauseEffect(service.clearChannelContext(channelId, host.channelActor())),
        remote: (channelId, serverId) =>
          remoteChatHistory(
            serverId,
            CHAT_HISTORY_ROUTES.channelClear,
            { channelId },
            "error.team.channelContextUnsupported",
          ),
      }),
      deleteChannelHistory: scopedHandler(parseChannelId, {
        local: (channelId) => runCauseEffect(service.deleteChannelHistory(channelId)),
        remote: (channelId, serverId) =>
          remoteChatHistory(
            serverId,
            CHAT_HISTORY_ROUTES.channelDelete,
            { channelId },
            "error.team.historyDeleteUnsupported",
          ),
      }),
      compactChannelContext: scopedHandler(parseChannelId, {
        local: (channelId) => runCauseEffect(service.compactChannelContext(channelId)),
        remote: (channelId, serverId) =>
          remoteChatHistory(
            serverId,
            CHAT_HISTORY_ROUTES.channelCompact,
            { channelId },
            "error.team.channelContextUnsupported",
          ),
      }),
      getSidebarLayout: scopedQueryHandler({
        local: () => sidebarLayout.getSnapshot(),
        remote: (serverId) =>
          remoteServers.supportsCapability(serverId, SIDEBAR_FOLDERS_CAPABILITY)
            ? remoteFolderLayout(serverId, {})
            : runCauseEffect(
                remoteServers.request(serverId, TEAM_API_ROUTES.sidebarLayout.state, decodeSidebarLayoutSnapshot),
              ),
      }),
      mutateSidebarLayout: scopedHandler(parseSidebarFolderAction, {
        local: (action) => runCauseEffect(sidebarLayout.mutate(action, service.sidebarChatIds())),
        remote: (action, serverId) => {
          if (remoteServers.supportsCapability(serverId, SIDEBAR_FOLDERS_CAPABILITY))
            return remoteFolderLayout(serverId, action);
          if (action.type === "nest" || (action.type === "create" && action.parentId !== undefined))
            throw new Error(sourceText("error.team.sidebarFoldersUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.sidebarLayout.actions, decodeSidebarLayoutSnapshot, {
              method: "POST",
              body: action,
            }),
          );
        },
      }),
      getSidebarPins: scopedQueryHandler({
        local: () => sidebarPins.snapshot(OWNER_PIN_KEY),
        remote: (serverId) => {
          if (!remoteServers.supportsCapability(serverId, SIDEBAR_PINS_CAPABILITY))
            throw new Error(sourceText("error.team.sidebarPinsUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, SIDEBAR_PINS_ROUTES.read, decodeSidebarPinsFromHost, {
              method: "POST",
              body: {},
            }),
          );
        },
      }),
      setSidebarPins: scopedHandler(parseSetSidebarPinsInput, {
        local: ({ items }) => runCauseEffect(sidebarPins.set(OWNER_PIN_KEY, items)),
        remote: (input, serverId) => saveRemoteSidebarPins(serverId, SIDEBAR_PINS_ROUTES.set, input),
      }),
      seedSidebarPins: scopedHandler(parseSetSidebarPinsInput, {
        local: ({ items }) => runCauseEffect(sidebarPins.seed(OWNER_PIN_KEY, items)),
        remote: (input, serverId) => saveRemoteSidebarPins(serverId, SIDEBAR_PINS_ROUTES.seed, input),
      }),
      generateProfile: scopedHandler(parseGenerateAgentProfile, {
        local: (input) => runCauseEffect(service.generateProfile(input, sidebarLayout.getSnapshot().sections)),
        remote: (input, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agents.generateProfile, decodeAgentProfileDraft, {
              method: "POST",
              body: input,
              timeoutMs: 150_000,
            }),
          ),
      }),
      askSideQuestion: scopedHandler(parseAskSideQuestion, {
        local: (input) => runCauseEffect(service.askSideQuestion(input)),
        remote: (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, SIDE_QUESTION_CAPABILITY))
            throw new Error(sourceText("error.team.sideQuestionUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, SIDE_QUESTION_ROUTES.ask, decodeSideQuestionResponse, {
              method: "POST",
              body: {
                agentId: input.agentId,
                question: input.question,
                earlier: input.earlier.map(({ question, answer }) => ({ question, answer })),
              },
              timeoutMs: 150_000,
            }),
          );
        },
      }),
      saveSkillSuggestion: scopedHandler(parseSaveSkillSuggestion, {
        local: (input) => runCauseEffect(service.saveSkillSuggestion(input)),
        remote: async (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, SKILL_LEARNING_CAPABILITY)) return { saved: false };
          return runCauseEffect(
            remoteServers.request(serverId, SKILL_LEARNING_ROUTES.save, decodeSaveSkillSuggestionResult, {
              method: "POST",
              body: { agentId: input.agentId, messageId: input.messageId },
              timeoutMs: 150_000,
            }),
          );
        },
      }),
      saveProfile: scopedHandler(parseSaveAgentProfile, {
        local: (input) => runCauseEffect(service.saveProfile(input, sidebarLayout, host.conversationSender())),
        remote: async (input, serverId) =>
          withRemoteFolders(
            serverId,
            await runCauseEffect(
              remoteServers.request(serverId, TEAM_API_ROUTES.agents.saveProfile, decodeSaveAgentProfileResult, {
                method: "POST",
                body: input,
              }),
            ),
          ),
      }),
      createAgent: scopedHandler(parseCreateAgent, {
        local: (parsed) =>
          runCauseEffect(service.createAgent(parsed, undefined, undefined, host.conversationSender(), true)),
        remote: async (parsed, serverId) => {
          const { avatarColor, providerAccountId, ...input } = parsed;
          const operation = remoteServers.supportsCapability(serverId, AGENT_CREATE_OPERATION_CAPABILITY)
            ? createOperationId([serverId, input])
            : null;
          const created = await runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummary, {
              method: "POST",
              body: operation ? { ...input, operationId: operation.id } : input,
            }),
          ).catch((error: unknown) => {
            operation?.failed();
            throw error;
          });
          const agent = await withCreatedAgentAccount(serverId, created, providerAccountId);
          if (!avatarColor || !remoteServers.supportsCapability(serverId, AGENT_COLORS_CAPABILITY)) return agent;
          await runCauseEffect(
            remoteServers
              .setAgentColor(serverId, { agentId: agent.id, color: avatarColor })
              .pipe(
                Effect.catch(() =>
                  Effect.sync(() =>
                    colorLogger.warn("The colour of a new remote agent was not set. The agent keeps the nearest hue."),
                  ),
                ),
              ),
          );
          return remoteServers.agentWithColor(serverId, agent);
        },
      }),
      duplicateAgent: scopedHandler(parseAgentId, {
        local: (agentId) =>
          runCauseEffect(
            duplicateAgentIntoLayout(service, sidebarLayout, agentId, undefined, (copyId) =>
              host.copyAgentAccess(agentId, copyId),
            ),
          ),
        remote: async (agentId, serverId) =>
          withRemoteFolders(serverId, await runCauseEffect(remoteServers.duplicateAgent(agentId, serverId))),
      }),
      updateAgent: scopedHandler(parseUpdateAgent, {
        local: (input) => runCauseEffect(service.updateAgent(input)),
        remote: async (input, serverId) => {
          if (input.access !== undefined) {
            throw new Error(sourceText("error.agent.accessLocalOnly"));
          }
          if (input.computerUse !== undefined) {
            throw new Error(sourceText("error.agent.computerUseLocalOnly"));
          }
          if (input.allowAutomation !== undefined) {
            throw new Error(sourceText("error.agent.automationLocalOnly"));
          }
          if (input.allowNewChat !== undefined) {
            throw new Error(sourceText("error.agent.newChatLocalOnly"));
          }
          if (input.quickAcknowledgement !== undefined) {
            throw new Error(sourceText("error.agent.quickAcknowledgementLocalOnly"));
          }
          if (input.fastMode !== undefined || input.ultrafast !== undefined) {
            throw new Error(sourceText("error.agent.settingsLocalOnly"));
          }
          if (input.busyMessageMode !== undefined) {
            throw new Error(sourceText("error.agent.busyMessageModeLocalOnly"));
          }
          if (input.taskLimit !== undefined) {
            throw new Error(sourceText("error.agent.taskLimitLocalOnly"));
          }
          if (input.backupModels !== undefined) {
            throw new Error(sourceText("error.agent.backupModelsLocalOnly"));
          }
          if (input.leaveUsageLimit !== undefined) {
            const { agentId, provider, model, reasoningEffort, providerAccountId } = input;
            if (
              input.leaveUsageLimit !== true ||
              provider === undefined ||
              model === undefined ||
              reasoningEffort === undefined ||
              !remoteServers.supportsCapability(serverId, AGENT_USAGE_LIMIT_CAPABILITY) ||
              Object.entries(input).some(([key, value]) => value !== undefined && !USAGE_LIMIT_MOVE_FIELDS.has(key))
            )
              throw new Error(sourceText("error.team.usageLimitUnsupported"));
            await runCauseEffect(
              remoteServers.request(serverId, AGENT_USAGE_LIMIT_ROUTES.switch, acceptEmpty, {
                method: "POST",
                body: {
                  agentId,
                  provider,
                  model,
                  reasoningEffort,
                  ...(providerAccountId ? { providerAccountId } : {}),
                },
              }),
            );
            const moved = (
              await runCauseEffect(remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries))
            ).find((agent) => agent.id === agentId);
            if (!moved) throw new Error(sourceText("error.team.agentNotFound"));
            const agent = remoteServers.agentWithColor(serverId, moved);
            return providerAccountId && providerAccountId !== DEFAULT_PROVIDER_ACCOUNT_ID
              ? { ...agent, providerAccountId }
              : agent;
          }
          const runtimeChange = remoteServers.supportsCapability(serverId, AGENT_PENDING_RUNTIME_CAPABILITY)
            ? pendingRuntimeUpdateBody(input)
            : null;
          if (runtimeChange) {
            const { agentId, providerAccountId } = input;
            await runCauseEffect(
              remoteServers.request(serverId, AGENT_PENDING_RUNTIME_ROUTES.update, acceptEmpty, {
                method: "POST",
                body: runtimeChange,
              }),
            );
            const changed = (
              await runCauseEffect(remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries))
            ).find((agent) => agent.id === agentId);
            if (!changed) throw new Error(sourceText("error.team.agentNotFound"));
            const agent = remoteServers.agentWithColor(serverId, changed);
            return !agent.pendingRuntime && providerAccountId && providerAccountId !== DEFAULT_PROVIDER_ACCOUNT_ID
              ? { ...agent, providerAccountId }
              : agent;
          }
          const { providerAccountId, avatarColor, chatColor, ...fields } = input;
          if (
            providerAccountId !== undefined &&
            !remoteServers.supportsCapability(serverId, PROVIDER_ACCOUNTS_CAPABILITY)
          )
            throw new Error(sourceText("error.team.providersUnsupported"));
          const chatColors = remoteServers.supportsCapability(serverId, CHAT_COLORS_CAPABILITY);
          if (
            chatColor !== undefined &&
            !chatColors &&
            Object.entries(input).every(
              ([key, value]) => key === "agentId" || key === "chatColor" || value === undefined,
            )
          )
            throw new Error(sourceText("error.team.chatColorsUnsupported"));
          if (chatColors && chatColor !== undefined)
            await runCauseEffect(
              remoteServers.setAgentChatColor(serverId, { agentId: input.agentId, color: chatColor }),
            );
          const colors = remoteServers.supportsCapability(serverId, AGENT_COLORS_CAPABILITY);
          const { avatarHue, ...rest } = fields;
          const update = colors && avatarColor ? rest : fields;
          if (colors && avatarColor !== undefined)
            await runCauseEffect(remoteServers.setAgentColor(serverId, { agentId: input.agentId, color: avatarColor }));
          const colourRouted = (chatColors && chatColor !== undefined) || (colors && avatarColor !== undefined);
          const profileChanged =
            !colourRouted || Object.entries(update).some(([key, value]) => key !== "agentId" && value !== undefined);
          const patched = profileChanged
            ? await runCauseEffect(
                remoteServers.request(serverId, TEAM_API_ROUTES.agent.one(input.agentId), decodeAgentSummary, {
                  method: "PATCH",
                  body: update,
                }),
              )
            : (
                await runCauseEffect(remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries))
              ).find((agent) => agent.id === input.agentId);
          if (!patched) throw new Error(sourceText("error.team.agentNotFound"));
          if (colors && avatarColor === undefined && avatarHue !== undefined)
            await runCauseEffect(remoteServers.readAgentColors(serverId).pipe(Effect.catch(() => Effect.void)));
          const agent = remoteServers.agentWithColor(serverId, patched);
          if (providerAccountId === undefined) return agent;
          await runCauseEffect(
            remoteServers.request(serverId, PROVIDER_ACCOUNTS_ROUTES.agent, acceptEmpty, {
              method: "POST",
              body: { agentId: input.agentId, accountId: providerAccountId },
            }),
          );
          return providerAccountId === null || providerAccountId === DEFAULT_PROVIDER_ACCOUNT_ID
            ? agent
            : { ...agent, providerAccountId };
        },
      }),
      setAvatar: scopedHandler(parseSetAgentAvatar, {
        local: (parsed) => runCauseEffect(service.setAvatar(parsed.agentId, parsed.image)),
        remote: (parsed, serverId) =>
          runCauseEffect(remoteServers.setAgentAvatar(parsed.agentId, parsed.image, serverId)),
      }),
      deleteAgent: scopedHandler(parseAgentId, {
        local: async (agentId) => {
          await runCauseEffect(service.deleteAgent(agentId));
          await runCauseEffect(sidebarLayout.removeAgent(agentId));
          await runCauseEffect(libraryFolders.removeAgent(agentId));
        },
        remote: async (agentId, serverId) => {
          await runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.one(agentId), decodeVoid, { method: "DELETE" }),
          );
        },
      }),
      readConversation: scopedHandler(parseAgentId, {
        local: (agentId) => runCauseEffect(host.readAgentConversation(agentId)),
        remote: (agentId, serverId) => runCauseEffect(remoteServers.readAgentConversation(agentId, serverId)),
      }),
      readConversationPage: scopedHandler(parseReadConversationPage, {
        local: (parsed) => runCauseEffect(host.readAgentConversationPage(parsed.agentId, parsed.anchor, parsed.limit)),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.readAgentConversationPage(parsed.agentId, parsed.anchor, parsed.limit, serverId),
          ),
      }),
      openMessageLink: scopedHandler(parseOpenMessageLink, {
        local: async ({ url }) => {
          await openMessageLink(url, openExternal);
          return null;
        },
        remote: ({ agentId, url }, serverId) => runCauseEffect(messageLinks.open(serverId, agentId, url)),
      }),
      pasteMessageLink: scopedHandler(parsePasteMessageLink, {
        local: () => Promise.reject(new Error(sourceText("error.mcp.relayEnded"))),
        remote: ({ url, address }, serverId) => runCauseEffect(messageLinks.paste(serverId, url, address)),
      }),
      cancelMessageLink: scopedHandler(parseCancelMessageLink, {
        local: async () => undefined,
        remote: ({ url }, serverId) => runCauseEffect(messageLinks.cancel(serverId, url)),
      }),
      searchConversationMessages: scopedHandler(parseSearchConversationMessages, {
        local: (parsed) =>
          host.searchAgentConversationMessages(
            parsed.query,
            parsed.agentId,
            parsed.cursor,
            parsed.limit,
            parsed.includeSideThreads,
          ),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.searchAgentConversationMessages(
              parsed.query,
              parsed.agentId,
              parsed.cursor,
              parsed.limit,
              serverId,
              parsed.includeSideThreads,
            ),
          ),
      }),
      searchConversationFiles: scopedHandler(parseSearchConversationFiles, {
        local: (parsed) => host.searchAgentConversationFiles(parsed.query, parsed.cursor, parsed.limit),
        remote: (parsed, serverId) => {
          if (!remoteServers.supportsCapability(serverId, CONVERSATION_FILE_SEARCH_CAPABILITY))
            throw new Error(sourceText("error.team.conversationFileSearchUnsupported"));
          return runCauseEffect(
            remoteServers.request(
              serverId,
              CONVERSATION_FILE_SEARCH_ROUTES.search,
              decodeConversationFileSearchResponse,
              {
                method: "POST",
                body: {
                  query: parsed.query,
                  cursor: parsed.cursor ?? null,
                  ...(parsed.limit === undefined ? {} : { limit: parsed.limit }),
                },
              },
            ),
          );
        },
      }),
      listConversationReads: scopedQueryHandler({
        local: () => host.listAgentConversationReads(),
        remote: (serverId) => runCauseEffect(remoteServers.listAgentConversationReads(serverId)),
      }),
      markConversationRead: scopedHandler(parseMarkConversationRead, {
        local: (parsed) => {
          closeChatNotifications(LOCAL_SERVER_ID, { agentId: parsed.agentId });
          return runCauseEffect(host.markAgentConversationRead(parsed));
        },
        remote: (parsed, serverId) => {
          closeChatNotifications(serverId, { agentId: parsed.agentId });
          return runCauseEffect(remoteServers.markAgentConversationRead(parsed, serverId));
        },
      }),
      markConversationUnread: scopedHandler(parseMarkConversationUnread, {
        local: (parsed) => runCauseEffect(host.markAgentConversationUnread(parsed)),
        remote: (parsed, serverId) => {
          if (!remoteServers.supportsCapability(serverId, CONVERSATION_UNREAD_FROM_CAPABILITY))
            throw new Error(sourceText("error.backend.markUnreadRemoteUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, CONVERSATION_UNREAD_FROM_ROUTE, decodeConversationReadState, {
              method: "POST",
              body: { agentId: parsed.agentId, fromMessageId: parsed.fromMessageId },
            }),
          );
        },
      }),
      deleteConversationMessage: scopedHandler(parseDeleteConversationMessage, {
        local: (input) =>
          runMessageDelete(service.deleteConversationMessage(input, { memberId: null, deleteAny: true })),
        remote: (input, serverId) =>
          input.taskId === undefined
            ? remoteMessageDelete(serverId, MESSAGE_DELETE_ROUTES.agent, {
                agentId: input.agentId,
                messageId: input.messageId,
              })
            : remoteMessageDelete(serverId, MESSAGE_DELETE_ROUTES.task, {
                agentId: input.agentId,
                taskId: input.taskId,
                messageId: input.messageId,
              }),
      }),
      withdrawFeedback: scopedHandler(parseWithdrawFeedback, {
        local: (input) => runCauseEffect(service.withdrawFeedback(input)),
        remote: (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, FEEDBACK_WITHDRAW_CAPABILITY))
            throw new Error(sourceText("error.backend.feedbackWithdrawRemoteUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, FEEDBACK_WITHDRAW_ROUTES.withdraw, decodeFeedbackWithdrawResult, {
              method: "POST",
              body: { agentId: input.agentId, messageId: input.messageId },
            }),
          );
        },
      }),
      sendMessage: scopedHandler(parseSendMessage, {
        local: (input) => runCauseEffect(service.sendMessage(input, host.conversationSender())),
        remote: (input, serverId) => {
          if (input.taskId) {
            const replyToMessageId = input.replyToMessageId;
            if (replyToMessageId)
              return remoteTaskRequest(serverId, AGENT_THREAD_REPLIES_ROUTES.send, decodeQueuedMessageReceipt, {
                agentId: input.agentId,
                taskId: input.taskId,
                text: input.text,
                attachmentDraftIds: input.attachmentDraftIds ?? [],
                replyToMessageId,
                ...(input.clientMessageId === undefined ? {} : { clientMessageId: input.clientMessageId }),
              });
            const files = input.attachmentDraftIds?.length ? { attachmentDraftIds: input.attachmentDraftIds } : null;
            return remoteTaskRequest(
              serverId,
              files ? AGENT_THREAD_FILES_ROUTES.send : AGENT_TASKS_ROUTES.send,
              decodeQueuedMessageReceipt,
              {
                agentId: input.agentId,
                taskId: input.taskId,
                text: input.text,
                ...files,
                ...(input.clientMessageId === undefined ? {} : { clientMessageId: input.clientMessageId }),
              },
            );
          }
          return runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.messages(input.agentId), decodeQueuedMessageReceipt, {
              method: "POST",
              body: { ...input, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
            }),
          );
        },
      }),
      setMessageReaction: scopedHandler(parseMessageReaction, {
        local: (parsed) => runCauseEffect(service.setMessageReaction(parsed, host.conversationSender())),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.reactions(parsed.agentId), decodeVoid, {
              method: "POST",
              body: parsed,
            }),
          ),
      }),
      listQueue: scopedHandler(parseAgentId, {
        local: (agentId) => service.listQueue(agentId),
        remote: (agentId, serverId) =>
          runCauseEffect(remoteServers.request(serverId, TEAM_API_ROUTES.agent.queue(agentId), decodeQueueSnapshot)),
      }),
      listActiveQueues: scopedHandler(parseAgentIdList, {
        local: (agentIds) => {
          const known = new Set(service.listAgents().map((agent) => agent.id));
          return { queues: service.listActiveQueues(agentIds.filter((id) => known.has(id))), omitted: [] };
        },
        remote: (agentIds, serverId) => {
          if (!remoteServers.supportsCapability(serverId, AGENT_ACTIVE_QUEUES_CAPABILITY)) return null;
          return runCauseEffect(
            remoteServers.request(serverId, AGENT_ACTIVE_QUEUES_ROUTES.list, decodeAgentActiveQueues, {
              method: "POST",
              body: { agentIds },
            }),
          );
        },
      }),
      listWaits: scopedHandler(parseAgentId, {
        local: (agentId) => service.listWaits(agentId),
        remote: (agentId, serverId) => {
          if (!remoteServers.supportsCapability(serverId, AGENT_WAITS_CAPABILITY)) return { agentId, waits: [] };
          return runCauseEffect(
            remoteServers.request(serverId, AGENT_WAITS_ROUTES.list, decodeAgentWaitsResponse, {
              method: "POST",
              body: { agentId },
            }),
          );
        },
      }),
      listPinnedMessages: scopedHandler(parseAgentId, {
        local: (agentId) => service.listPinnedMessages(agentId),
        remote: (agentId, serverId) => {
          if (!remoteServers.supportsCapability(serverId, MESSAGE_PINS_CAPABILITY)) return { agentId, pins: [] };
          return runCauseEffect(
            remoteServers.request(serverId, MESSAGE_PINS_ROUTES.list, decodeMessagePinsResponse, {
              method: "POST",
              body: { agentId },
            }),
          );
        },
      }),
      setMessagePinned: scopedHandler(parseSetMessagePinned, {
        local: (input) => runMessagePin(service.setMessagePinned(input, { kind: "person", sender: null })),
        remote: (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, MESSAGE_PINS_CAPABILITY))
            throw new Error(sourceText("error.team.messagePinsUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, MESSAGE_PINS_ROUTES.set, decodeMessagePinsResponse, {
              method: "POST",
              body: {
                agentId: input.agentId,
                taskId: input.taskId ?? null,
                messageId: input.messageId,
                pinned: input.pinned,
              },
            }),
          );
        },
      }),
      cancelWait: scopedHandler(parseCancelAgentWait, {
        local: (parsed) => service.cancelWait(parsed.agentId, parsed.waitId),
        remote: async (parsed, serverId) => {
          if (!remoteServers.supportsCapability(serverId, AGENT_WAITS_CAPABILITY))
            throw new Error(sourceText("error.team.agentWaitsUnsupported"));
          await runCauseEffect(
            remoteServers.request(serverId, AGENT_WAITS_ROUTES.cancel, acceptEmpty, {
              method: "POST",
              body: { agentId: parsed.agentId, waitId: parsed.waitId },
            }),
          );
        },
      }),
      listTasks: scopedHandler(parseAgentId, {
        local: (agentId) => service.listTasks(agentId),
        remote: (agentId, serverId) => {
          if (!remoteServers.supportsCapability(serverId, AGENT_TASKS_CAPABILITY))
            return { agentId, tasks: [], limit: 1 };
          const init = { method: "POST", body: { agentId } } as const;
          const branched = remoteServers.supportsCapability(serverId, AGENT_THREAD_BRANCHES_CAPABILITY);
          const queued = remoteServers.supportsCapability(serverId, AGENT_THREAD_QUEUE_CAPABILITY);
          const requested = remoteServers.supportsCapability(serverId, AGENT_THREAD_REQUESTS_CAPABILITY);
          return runCauseEffect(
            Effect.gen(function* () {
              let snapshot = yield* remoteServers.request(
                serverId,
                AGENT_TASKS_ROUTES.list,
                decodeRemoteAgentTasks,
                init,
              );
              if (branched) {
                const links = yield* remoteServers.request(
                  serverId,
                  AGENT_THREAD_BRANCHES_ROUTES.list,
                  decodeRemoteAgentThreadBranches,
                  init,
                );
                snapshot = withAgentThreadBranches(snapshot, links.branches);
              }
              if (requested) {
                const requests = yield* remoteServers.request(
                  serverId,
                  AGENT_THREAD_REQUESTS_ROUTES.list,
                  decodeRemoteAgentThreadRequests,
                  init,
                );
                snapshot = withAgentThreadRequests(snapshot, requests);
              }
              if (!queued) return snapshot;
              const queues = yield* remoteServers.request(
                serverId,
                AGENT_THREAD_QUEUE_ROUTES.list,
                decodeRemoteAgentThreadQueues,
                init,
              );
              return withAgentThreadQueues(snapshot, queues);
            }),
          );
        },
      }),
      readTask: scopedHandler(parseAgentTask, {
        local: (parsed) => service.readTask(parsed.agentId, parsed.taskId),
        remote: (parsed, serverId) =>
          remoteTaskRequest(serverId, AGENT_TASKS_ROUTES.read, decodeRemoteTaskConversation, agentTaskBody(parsed)),
      }),
      readTaskPage: scopedHandler(parseReadAgentTaskPage, {
        local: (parsed) => service.readTaskPage(parsed),
        remote: (parsed, serverId) => {
          if (!remoteServers.supportsCapability(serverId, AGENT_THREAD_PAGES_CAPABILITY)) taskRemoteUnsupported();
          return runCauseEffect(
            remoteServers.request(serverId, AGENT_THREAD_PAGES_ROUTES.readOlder, decodeRemoteTaskPage, {
              method: "POST",
              body: {
                agentId: parsed.agentId,
                taskId: parsed.taskId,
                beforeMessageId: parsed.beforeMessageId,
                limit: parsed.limit,
              },
            }),
          );
        },
      }),
      readTaskAround: scopedHandler(parseReadAgentTaskAround, {
        local: (parsed) => service.readTaskAround(parsed),
        remote: (parsed, serverId) => {
          if (!remoteServers.supportsCapability(serverId, MESSAGE_PINS_CAPABILITY)) taskRemoteUnsupported();
          return runCauseEffect(
            remoteServers.request(serverId, MESSAGE_PINS_ROUTES.readThread, decodeRemoteTaskWindow, {
              method: "POST",
              body: {
                agentId: parsed.agentId,
                taskId: parsed.taskId,
                messageId: parsed.messageId,
                limit: parsed.limit,
              },
            }),
          );
        },
      }),
      startTask: scopedHandler(parseStartAgentTask, {
        local: (input) => runCauseEffect(service.startTask(input, host.conversationSender())),
        remote: (input, serverId) => {
          const files = input.attachmentDraftIds?.length ? { attachmentDraftIds: input.attachmentDraftIds } : null;
          return remoteTaskRequest(
            serverId,
            files ? AGENT_THREAD_FILES_ROUTES.start : AGENT_TASKS_ROUTES.start,
            decodeRemoteAgentTask,
            {
              agentId: input.agentId,
              text: input.text,
              ...files,
              ...(input.clientMessageId === undefined ? {} : { clientMessageId: input.clientMessageId }),
            },
          );
        },
      }),
      runQueuedMessageAsTask: scopedHandler(parseRunQueuedMessageAsTask, {
        local: (parsed) => runCauseEffect(service.runQueuedMessageAsTask(parsed)),
        remote: (parsed, serverId) => {
          if (!remoteServers.supportsCapability(serverId, AGENT_QUEUE_TASK_CAPABILITY))
            throw new Error(sourceText("error.team.queuedMessageThreadUnsupported"));
          return remoteTaskRequest(serverId, AGENT_QUEUE_TASK_ROUTES.run, decodeRemoteAgentTask, {
            agentId: parsed.agentId,
            deliveryId: parsed.deliveryId,
          });
        },
      }),
      branchTask: scopedHandler(parseBranchAgentTask, {
        local: (parsed) => runCauseEffect(host.branchAgentTask(parsed)),
        remote: (parsed, serverId) => {
          if (!remoteServers.supportsCapability(serverId, AGENT_THREAD_BRANCHES_CAPABILITY))
            throw new Error(sourceText("error.backend.branchRemoteUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, AGENT_THREAD_BRANCHES_ROUTES.branch, decodeRemoteAgentTask, {
              method: "POST",
              body: {
                agentId: parsed.agentId,
                taskId: parsed.taskId,
                messageId: parsed.messageId,
                requestId: parsed.requestId,
              },
            }),
          );
        },
      }),
      stopTask: scopedHandler(parseAgentTask, {
        local: (parsed) => runCauseEffect(service.stopTask(parsed)),
        remote: (parsed, serverId) =>
          remoteTaskRequest(serverId, AGENT_TASKS_ROUTES.stop, acceptEmpty, agentTaskBody(parsed)),
      }),
      closeTask: scopedHandler(parseAgentTask, {
        local: (parsed) => runCauseEffect(service.closeTask(parsed)),
        remote: (parsed, serverId) =>
          remoteTaskRequest(serverId, AGENT_TASKS_ROUTES.close, acceptEmpty, agentTaskBody(parsed)),
      }),
      reopenTask: scopedHandler(parseAgentTask, {
        local: (parsed) => service.reopenTask(parsed),
        remote: (parsed, serverId) =>
          remoteTaskRequest(serverId, AGENT_TASKS_ROUTES.reopen, acceptEmpty, agentTaskBody(parsed)),
      }),
      renameTask: scopedHandler(parseRenameAgentTask, {
        local: (parsed) => service.renameTask(parsed, parsed.title),
        remote: (parsed, serverId) =>
          remoteThreadRequest(serverId, AGENT_THREADS_ROUTES.rename, {
            agentId: parsed.agentId,
            taskId: parsed.taskId,
            title: parsed.title,
          }),
      }),
      deleteTask: scopedHandler(parseAgentTask, {
        local: (parsed) => runCauseEffect(service.deleteTask(parsed)),
        remote: (parsed, serverId) => remoteThreadRequest(serverId, AGENT_THREADS_ROUTES.delete, agentTaskBody(parsed)),
      }),
      listTaskReads: scopedHandler(parseAgentId, {
        local: (agentId) => host.listAgentTaskReads(agentId),
        remote: (agentId, serverId) => {
          if (!remoteServers.supportsCapability(serverId, AGENT_THREAD_READS_CAPABILITY)) return [];
          return runCauseEffect(
            remoteServers.request(serverId, AGENT_THREAD_READS_ROUTES.list, decodeRemoteTaskReadStates, {
              method: "POST",
              body: { agentId },
            }),
          );
        },
      }),
      markTaskRead: scopedHandler(parseMarkAgentTaskRead, {
        local: (parsed) => host.markAgentTaskRead(parsed),
        remote: (parsed, serverId) => {
          if (!remoteServers.supportsCapability(serverId, AGENT_THREAD_READS_CAPABILITY)) taskRemoteUnsupported();
          return runCauseEffect(
            remoteServers.request(serverId, AGENT_THREAD_READS_ROUTES.mark, decodeRemoteTaskReadState, {
              method: "POST",
              body: { agentId: parsed.agentId, taskId: parsed.taskId, throughMessageId: parsed.throughMessageId },
            }),
          );
        },
      }),
      acknowledgeFailedTurn: scopedHandler(parseAcknowledgeFailedTurn, {
        local: (parsed) => service.acknowledgeFailedTurn(parsed.agentId, parsed.turnId),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.failuresAcknowledge(parsed.agentId), decodeVoid, {
              method: "POST",
              body: { turnId: parsed.turnId },
            }),
          ),
      }),
      cancelQueuedMessage: scopedHandler(parseCancelQueuedMessage, {
        local: (parsed) => runCauseEffect(service.cancelQueuedMessage(parsed.agentId, parsed.deliveryId)),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.queueCancel(parsed.agentId), decodeVoid, {
              method: "POST",
              body: { deliveryId: parsed.deliveryId },
            }),
          ),
      }),
      steerQueuedMessage: scopedHandler(parseSteerQueuedMessage, {
        local: (parsed) => runCauseEffect(service.steerQueuedMessage(parsed)),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.queueSteer(parsed.agentId), decodeVoid, {
              method: "POST",
              body: { deliveryId: parsed.deliveryId, expectedTurnId: parsed.expectedTurnId },
            }),
          ),
      }),
      editQueuedMessage: scopedHandler(parseQueueEdit, {
        local: ({ agentId, ...input }) =>
          runCauseEffect(service.editQueuedMessage(agentId, input, host.conversationSender())),
        remote: ({ agentId, ...input }, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.queueEdit(agentId), decodeQueueSnapshot, {
              method: "POST",
              body: { ...input },
            }),
          ),
      }),
      updateQueuedMessage: scopedHandler(parseUpdateQueuedMessage, {
        local: (parsed) => runCauseEffect(service.updateQueuedMessage(parsed, host.conversationSender())),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.queueUpdate(parsed.agentId), decodeVoid, {
              method: "POST",
              body: {
                deliveryId: parsed.deliveryId,
                text: parsed.text,
                keepAttachmentIds: parsed.keepAttachmentIds,
                attachmentDraftIds: parsed.attachmentDraftIds,
              },
            }),
          ),
      }),
      reorderQueue: scopedHandler(parseReorderQueue, {
        local: (parsed) => runCauseEffect(service.reorderQueue(parsed)),
        remote: (parsed, serverId) => {
          if (parsed.taskId !== undefined) {
            if (!remoteServers.supportsCapability(serverId, AGENT_THREAD_QUEUE_CAPABILITY))
              throw new Error(sourceText("error.team.threadQueueUnsupported"));
            return runCauseEffect(
              remoteServers.request(serverId, AGENT_THREAD_QUEUE_ROUTES.reorder, acceptEmpty, {
                method: "POST",
                body: { agentId: parsed.agentId, taskId: parsed.taskId, deliveryIds: parsed.deliveryIds },
              }),
            );
          }
          return runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.queueReorder(parsed.agentId), decodeVoid, {
              method: "POST",
              body: { deliveryIds: parsed.deliveryIds },
            }),
          );
        },
      }),
      interrupt: scopedHandler(parseInterrupt, {
        local: (parsed) => runCauseEffect(service.interrupt(parsed.agentId, parsed.turnId)),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.interrupt(parsed.agentId), decodeVoid, {
              method: "POST",
              body: { turnId: parsed.turnId },
            }),
          ),
      }),
      clearContext: scopedHandler(parseAgentId, {
        local: (agentId) => runCauseEffect(service.clearAgentContext(agentId)),
        remote: async (agentId, serverId) => {
          if (!remoteServers.supportsCapability(serverId, CONTEXT_RESET_CAPABILITY))
            throw new Error(sourceText("error.team.contextResetUnsupported"));
          await runCauseEffect(
            remoteServers.request(serverId, CONTEXT_RESET_ROUTES.clear, () => undefined, {
              method: "POST",
              body: { agentId },
            }),
          );
        },
      }),
      deleteHistory: scopedHandler(parseAgentId, {
        local: (agentId) => runCauseEffect(service.deleteAgentHistory(agentId)),
        remote: (agentId, serverId) =>
          remoteChatHistory(
            serverId,
            CHAT_HISTORY_ROUTES.agentDelete,
            { agentId },
            "error.team.historyDeleteUnsupported",
          ),
      }),
      compactContext: scopedHandler(parseAgentId, {
        local: (agentId) => runCauseEffect(service.compactAgentContext(agentId)),
        remote: (agentId, serverId) => remoteCompact(serverId, CONTEXT_COMPACT_ROUTES.compact, { agentId }),
      }),
      compactTaskContext: scopedHandler(parseAgentTask, {
        local: (parsed) => runCauseEffect(service.compactTaskContext(parsed)),
        remote: ({ agentId, taskId }, serverId) =>
          remoteCompact(serverId, CONTEXT_COMPACT_ROUTES.compactTask, { agentId, taskId }),
      }),
      respondToPrompt: scopedHandler(parsePromptResponse, {
        local: (parsed) => runCauseEffect(service.respondToPrompt(parsed)),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.respond.prompt, decodeVoid, {
              method: "POST",
              body: parsed,
            }),
          ),
      }),
      respondToApproval: scopedHandler(parseApprovalResponse, {
        local: (parsed) => runCauseEffect(service.respondToApproval(parsed)),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.respond.approval, decodeVoid, {
              method: "POST",
              body: parsed,
            }),
          ),
      }),
      readPendingApproval: scopedHandler(parseReadPendingApprovalInput, {
        local: ({ agentId, requestId }) => {
          const approval = service.pendingApproval(requestId);
          return approval?.agentId === agentId ? approval : null;
        },
        remote: (parsed, serverId) => {
          if (!remoteServers.supportsCapability(serverId, PENDING_APPROVAL_CAPABILITY)) return null;
          return runCauseEffect(
            remoteServers.request(serverId, PENDING_APPROVAL_ROUTES.read, decodePendingApprovalResponse, {
              method: "POST",
              body: { ...parsed },
            }),
          );
        },
      }),
      listPendingPrompts: scopedQueryHandler({
        local: () => pendingPromptsWithinLimits(service.pendingPrompts()),
        remote: (serverId) => {
          if (!remoteServers.supportsCapability(serverId, PENDING_PROMPTS_CAPABILITY)) return [];
          return runCauseEffect(
            remoteServers.request(serverId, PENDING_PROMPTS_ROUTES.list, decodePendingPromptsResponse, {
              method: "POST",
              body: {},
            }),
          );
        },
      }),
      respondToBrowserSecret: scopedHandler(parseLocalBrowserSecretResponse, {
        local: (parsed) => runCauseEffect(service.respondToBrowserSecret(parsed)),
        remote: (parsed, serverId) => {
          if (parsed.decision !== "submit" || !parsed.saveToVault)
            return runCauseEffect(
              remoteServers.request(serverId, BROWSER_SECRET_RESPONSE_PATH, decodeVoid, {
                method: "POST",
                body: remoteBrowserSecretResponse(parsed),
              }),
            );
          if (!remoteServers.supportsCapability(serverId, BROWSER_SECRET_VAULT_CAPABILITY))
            throw new Error(sourceText("error.team.vaultUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, BROWSER_SECRET_VAULT_ROUTES.respond, acceptEmpty, {
              method: "POST",
              body: remoteBrowserSecretResponse(parsed),
            }),
          );
        },
      }),
      respondToBrowserTakeover: scopedHandler(parseBrowserTakeoverResponse, {
        local: (parsed) => runCauseEffect(service.respondToBrowserTakeover(parsed)),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.respond.browserTakeover, decodeVoid, {
              method: "POST",
              body: parsed,
            }),
          ),
      }),
    },
  };
}
