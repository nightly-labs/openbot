import { AGENT_COLORS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-colors-v1";
import {
  AGENT_FAST_MODE_CAPABILITY,
  AGENT_FAST_MODE_ROUTES,
} from "@openbot/contracts/team-protocol/agent-fast-mode-v1";
import { AGENT_HIDDEN_CAPABILITY, AGENT_HIDDEN_ROUTES } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import {
  AGENT_SESSION_SETTINGS_CAPABILITY,
  AGENT_SESSION_SETTINGS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-session-settings-v1";
import {
  BROWSER_SECRET_VAULT_CAPABILITY,
  BROWSER_SECRET_VAULT_ROUTES,
} from "@openbot/contracts/team-protocol/browser-secret-vault-v1";
import { CHAT_COLORS_CAPABILITY } from "@openbot/contracts/team-protocol/chat-colors-v1";
import {
  MODEL_VISIBILITY_CAPABILITY,
  MODEL_VISIBILITY_ROUTES,
} from "@openbot/contracts/team-protocol/model-visibility-v1";
import {
  SIDEBAR_FOLDERS_CAPABILITY,
  SIDEBAR_FOLDERS_ROUTES,
} from "@openbot/contracts/team-protocol/sidebar-folders-v1";
import { SIDEBAR_PINS_CAPABILITY, SIDEBAR_PINS_ROUTES } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
// An agent's core surface: status, agents, conversations, the queue and the prompts
// a turn can raise. Memories, routines and attachments are their own registrars.
// Every one of these routes to the local service or to a remote server by the
// `serverId` in the request.

import {
  type AgentTaskInput,
  analyticsQuery,
  assertAnalyticsScope,
  assertHostAnalyticsScope,
  BROWSER_SECRET_RESPONSE_PATH,
  CHANNEL_DELETE_CAPABILITY,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  decodeAgentFastModels,
  decodeAgentModelListings,
  decodeAgentProfileDraft,
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
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
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
  AGENT_THREAD_READS_CAPABILITY,
  AGENT_THREAD_READS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-reads-v1";
import {
  AGENT_THREAD_REPLIES_CAPABILITY,
  AGENT_THREAD_REPLIES_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-replies-v1";
import { AGENT_THREADS_CAPABILITY, AGENT_THREADS_ROUTES } from "@openbot/contracts/team-protocol/agent-threads-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { CHAT_HISTORY_CAPABILITY, CHAT_HISTORY_ROUTES } from "@openbot/contracts/team-protocol/chat-history-v1";
import {
  CONTEXT_COMPACT_CAPABILITY,
  CONTEXT_COMPACT_ROUTES,
} from "@openbot/contracts/team-protocol/context-compact-v1";
import { CONTEXT_RESET_CAPABILITY, CONTEXT_RESET_ROUTES } from "@openbot/contracts/team-protocol/context-reset-v1";
import {
  CONVERSATION_UNREAD_FROM_CAPABILITY,
  CONVERSATION_UNREAD_FROM_ROUTE,
} from "@openbot/contracts/team-protocol/conversation-unread-from-v1";
import { MESSAGE_DELETE_CAPABILITY, MESSAGE_DELETE_ROUTES } from "@openbot/contracts/team-protocol/message-delete-v1";
import {
  PROVIDER_ACCOUNTS_CAPABILITY,
  PROVIDER_ACCOUNTS_ROUTES,
} from "@openbot/contracts/team-protocol/provider-accounts-v1";
import {
  decodeSideQuestionResponse,
  SIDE_QUESTION_CAPABILITY,
  SIDE_QUESTION_ROUTES,
} from "@openbot/contracts/team-protocol/side-question-v1";
import { SKILL_LEARNING_CAPABILITY, SKILL_LEARNING_ROUTES } from "@openbot/contracts/team-protocol/skill-learning-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { duplicateAgentIntoLayout } from "../../backend/agent/duplication-gate";
import type { AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { SidebarLayoutStore } from "../../backend/sidebar-layout-store";
import type { HostService } from "../host-service";
import { runMessageDelete } from "../message-delete-refusal";
import { type MessageLinkRelay, openHttpLink } from "../message-link-relay";
import type { ModelVisibility } from "../model-visibility";
import {
  decodeAccountUsageFromHost,
  decodeAgentAnalyticsFromHost,
  decodeAgentModelOptions,
  decodeAgentSessionSettingsFromHost,
  decodeAgentStatusFromHost,
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
  decodeRemoteTaskConversation,
  decodeRemoteTaskPage,
  decodeRemoteTaskReadState,
  decodeRemoteTaskReadStates,
  decodeSidebarLayoutSnapshot,
  decodeSidebarPinsFromHost,
} from "../remote-agent-decoding";
import { decodeConversationReadState } from "../remote-conversation-decoding";
import { acceptEmpty, decodeVoid, type ResponseDecoder } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import { OWNER_PIN_KEY, type SidebarPinStore } from "../sidebar-pin-store";
import type { SkillMarketplaceService } from "../skill-marketplace-service";
import {
  parseAcknowledgeFailedTurn,
  parseAgentId,
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
  parseReadAgentTaskPage,
  parseReadConversationPage,
  parseRenameAgentTask,
  parseReorderQueue,
  parseRunQueuedMessageAsTask,
  parseSearchConversationFiles,
  parseSearchConversationMessages,
  parseSendMessage,
  parseSetAgentAvatar,
  parseSetChannelImage,
  parseSidebarFolderAction,
  parseStartAgentTask,
  parseSteerQueuedMessage,
  parseUpdateAgent,
  parseUpdateQueuedMessage,
} from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

/** Its lines also go to the provider log. See `PROVIDER_LOG_PREFIXES`. */
const modelLogger = createOpenBotLogger("provider-models");
const colorLogger = createOpenBotLogger("agent-colors");

/** A joined server without `agent-tasks-v1`, or a task request that it cannot carry, fails with a reason. */
function taskRemoteUnsupported(): never {
  throw new Error(sourceText("error.backend.threadRemoteUnsupported"));
}

/**
 * The body of an `agent-tasks-v1` request: the agent, with the task, the text of a start or message, or
 * both. Only the `agent-thread-files-v1` and `agent-thread-replies-v1` routes carry `attachmentDraftIds`,
 * and only `agent-thread-replies-v1` carries `replyToMessageId`.
 */
interface RemoteTaskBody {
  agentId: string;
  taskId?: string;
  text?: string;
  attachmentDraftIds?: string[];
  replyToMessageId?: string;
  clientMessageId?: string;
}

function agentTaskBody(input: AgentTaskInput): AgentTaskInput {
  return { agentId: input.agentId, taskId: input.taskId };
}

/**
 * Names each member of a model list that fails `isAgentModelOption`, and returns the list unchanged.
 * The preload refuses the whole list for one such member and has no log of its own, so without this
 * the window shows "Invalid agent model response." and nothing records which model it was.
 */
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
  sidebarPins: SidebarPinStore;
  host: HostService;
  remoteServers: RemoteServerManager;
  skills: SkillMarketplaceService;
  messageLinks: MessageLinkRelay;
  openExternal: (url: string) => Promise<void>;
  /** The models that the model picker shows. Only the local list is filtered here; a host filters its own. */
  modelVisibility: Pick<ModelVisibility, "picker">;
}

export function agentIpcHandlers({
  service,
  sidebarLayout,
  sidebarPins,
  host,
  remoteServers,
  skills,
  messageLinks,
  openExternal,
  modelVisibility,
}: AgentIpcDependencies): Pick<IpcGroupHandlers, "agent"> {
  const remoteTaskRequest = <T>(serverId: string, path: string, decoder: ResponseDecoder<T>, body: RemoteTaskBody) => {
    if (!remoteServers.supportsCapability(serverId, AGENT_TASKS_CAPABILITY)) taskRemoteUnsupported();
    // `agent-tasks-v1` carries text only; a host with `agent-thread-files-v1` takes files on its own routes.
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
  // The context-compact-v1 codec has already checked the empty reply.
  const remoteCompact = async (serverId: string, path: string, body: AgentTaskInput | { agentId: string }) => {
    if (!remoteServers.supportsCapability(serverId, CONTEXT_COMPACT_CAPABILITY))
      throw new Error(sourceText("error.team.contextCompactUnsupported"));
    await runCauseEffect(remoteServers.request(serverId, path, acceptEmpty, { method: "POST", body }));
  };
  // The chat-history-v1 codec has already checked the empty reply. The host says why it refuses.
  const remoteChatHistory = async (
    serverId: string,
    path: string,
    body: { agentId: string } | { channelId: string },
    unsupported: "error.team.channelContextUnsupported" | "error.team.historyDeleteUnsupported",
  ) => {
    if (!remoteServers.supportsCapability(serverId, CHAT_HISTORY_CAPABILITY)) throw new Error(sourceText(unsupported));
    await runCauseEffect(remoteServers.request(serverId, path, acceptEmpty, { method: "POST", body }));
  };
  // The message-delete-v1 codec has already checked the empty reply. The host says why it refuses.
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
  // `sidebar-folders-v1` reads the layout with the parent of each folder. A released route answers it
  // without them, so a result of one is read again: the renderer would show the folders flat.
  const remoteFolderLayout = (serverId: string, body: SidebarLayoutAction | Record<string, never>) =>
    runCauseEffect(
      remoteServers.request(
        serverId,
        "type" in body ? SIDEBAR_FOLDERS_ROUTES.actions : SIDEBAR_FOLDERS_ROUTES.read,
        decodeSidebarLayoutSnapshot,
        { method: "POST", body },
      ),
    );
  // The save or the copy is done when the second read starts. A failed read keeps the layout of the
  // answer, so the caller does not try again and make a second agent; the next layout event has the parents.
  const withRemoteFolders = async <T extends { layout: SidebarLayoutSnapshot }>(serverId: string, result: T) =>
    remoteServers.supportsCapability(serverId, SIDEBAR_FOLDERS_CAPABILITY)
      ? { ...result, layout: await remoteFolderLayout(serverId, {}).catch(() => result.layout) }
      : result;
  return {
    agent: {
      getStatus: scopedQueryHandler({
        local: () => service.getStatus(),
        remote: (serverId) =>
          runCauseEffect(remoteServers.request(serverId, TEAM_API_ROUTES.agents.status, decodeAgentStatusFromHost)),
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
        remote: (agentId, serverId) =>
          agentId
            ? remoteServers.supportsCapability(serverId, "model-scoped-usage")
              ? runCauseEffect(
                  remoteServers.request(serverId, TEAM_API_ROUTES.agent.usage(agentId), decodeAccountUsageFromHost),
                )
              : { limits: [] }
            : runCauseEffect(remoteServers.request(serverId, TEAM_API_ROUTES.agents.usage, decodeAccountUsageFromHost)),
      }),
      listModels: scopedQueryHandler({
        local: () => runCauseEffect(modelVisibility.picker(logRejectedModels(service.listModels(), "local"))),
        remote: (serverId) => {
          const models = remoteServers.request(serverId, TEAM_API_ROUTES.agents.models, (value) =>
            decodeAgentModelOptions(logRejectedModels(value, "remote")),
          );
          // The released model list drops the fast tier and the picker listing, so a host with
          // `agent-fast-mode-v1` or `model-visibility-v1` gives them on their own routes. Both are
          // optional: when a route fails, the picker gets the models with no Fast switch or listing.
          return runCauseEffect(
            Effect.gen(function* () {
              const fast = remoteServers.supportsCapability(serverId, AGENT_FAST_MODE_CAPABILITY)
                ? remoteServers
                    .request(serverId, AGENT_FAST_MODE_ROUTES.models, decodeAgentFastModels, {
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
              // The three requests go to the same host at the same time.
              const [options, fastModels, listed] = yield* Effect.all([models, fast, listings], {
                concurrency: "unbounded",
              });
              return withModelListings(withFastServiceTiers(options, fastModels), listed);
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
        // A server without `agent-hidden-v1` cannot hide an agent, so it has no hidden agents.
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
      // The manager keeps the levels of each server, so the server list shows the level that they set.
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
        // The released agent list has no exact colour and no chat colour, so `agent-colors-v1` and
        // `chat-colors-v1` give them on their own routes.
        remote: (serverId) =>
          runCauseEffect(
            Effect.all(
              [
                remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries),
                // A failed read keeps the last colours. An agent without a colour shows its hue.
                remoteServers.readAgentColors(serverId).pipe(Effect.catch(() => Effect.void)),
                // A failed read keeps the last chat colours.
                remoteServers.readChatColors(serverId).pipe(Effect.catch(() => Effect.void)),
              ],
              { concurrency: "unbounded" },
            ).pipe(Effect.map(([agents]) => remoteServers.withAgentColors(serverId, agents))),
          ),
      }),
      listInstalledSkills: scopedHandler(parseAgentId, {
        local: (agentId) => runCauseEffect(skills.listInstalledForChatTags(agentId)),
        // A server too old to know the endpoint would answer 404, so ask its advertised capabilities first.
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
        // The reader here is the host user of this computer, so messages they wrote before they
        // signed in are their own.
        local: () => service.channels.store.list(host.channelActor().id, true),
        remote: (serverId) =>
          runCauseEffect(remoteServers.request(serverId, CHANNEL_ROUTES.list, decodeChannelSummaries)),
      }),
      readChannel: scopedHandler(parseChannelRead, {
        local: (input) => service.channels.store.page(input.channelId, input.beforeSequence),
        remote: (input, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, CHANNEL_ROUTES.read, decodeChannelPage, { method: "POST", body: input }),
          ),
      }),
      channelCommand: scopedHandler(parseChannelCommand, {
        local: (input) => runCauseEffect(service.channels.command(input, host.channelActor())),
        remote: (input, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, CHANNEL_ROUTES.command, decodeChannel, { method: "POST", body: input }),
          ),
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
      // The user of this computer can delete any message of a local channel.
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
        // The channel editor offers an image only for this computer, so only a programming error gets here.
        remote: () => {
          throw new Error(sourceText("error.team.channelPictureUnsupported"));
        },
      }),
      // A joined server serves these with `chat-history-v1`.
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
          // The released route has every folder at the top: it refuses `nest`, and would drop a parent.
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
      // The owner of this computer shares the pins of this server with their phones.
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
              // The wire fields only, so that a new IPC field does not cross the frozen contract.
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
          // An older host has no route: the card then sends the user's yes to the agent.
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
        // The renderer always sends a setup message to its own host.
        local: (parsed) =>
          runCauseEffect(service.createAgent(parsed, undefined, undefined, host.conversationSender(), true)),
        remote: async (parsed, serverId) => {
          // The released route keeps the nearest hue. The exact colour goes on `agent-colors-v1` after it.
          // The released route does not carry the account, so a remote agent starts on the provider's own sign-in.
          const { avatarColor, providerAccountId: _localOnly, ...input } = parsed;
          const agent = await runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummary, {
              method: "POST",
              body: input,
            }),
          );
          if (!avatarColor || !remoteServers.supportsCapability(serverId, AGENT_COLORS_CAPABILITY)) return agent;
          // The agent exists, so a failed colour change does not fail the create: the agent keeps its hue.
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
          // The Team API does not carry access, and a team member must not be able to widen it.
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
          // The released agent route does not carry it; the renderer sends it on `agent-plan-card-v1`.
          if (input.quickAcknowledgement !== undefined) {
            throw new Error(sourceText("error.agent.quickAcknowledgementLocalOnly"));
          }
          if (input.fastMode !== undefined) {
            throw new Error(sourceText("error.agent.settingsLocalOnly"));
          }
          if (input.busyMessageMode !== undefined) {
            throw new Error(sourceText("error.agent.busyMessageModeLocalOnly"));
          }
          // The released agent route does not carry the task limit; the renderer sends it on `agent-task-limit-v1`.
          if (input.taskLimit !== undefined) {
            throw new Error(sourceText("error.agent.taskLimitLocalOnly"));
          }
          if (input.backupModels !== undefined || input.leaveUsageLimit !== undefined) {
            throw new Error(sourceText("error.agent.backupModelsLocalOnly"));
          }
          // The released agent route does not carry the account, so it changes on its own route after
          // the rest: a provider change on the host returns the agent to the new provider's own sign-in.
          const { providerAccountId, avatarColor, chatColor, ...fields } = input;
          if (
            providerAccountId !== undefined &&
            !remoteServers.supportsCapability(serverId, PROVIDER_ACCOUNTS_CAPABILITY)
          )
            throw new Error(sourceText("error.team.providersUnsupported"));
          // The released agent route does not carry the chat colour, so it goes on `chat-colors-v1` first.
          // Without the capability, a change of only the chat colour fails. With other fields, they change
          // and the chat colour stays.
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
          // The released agent route does not carry the exact colour. With `agent-colors-v1` it goes on
          // its own route first. That route also sets the nearest hue, so the profile change then leaves
          // the hue out: on the released route a hue removes the colour. A removed colour keeps the hue,
          // which then sets the colour that the user chose. The released route removes the colour only
          // when the hue changes, so a removed colour always goes on the colour route. Without the
          // capability, only the hue goes.
          const colors = remoteServers.supportsCapability(serverId, AGENT_COLORS_CAPABILITY);
          const { avatarHue, ...rest } = fields;
          const update = colors && avatarColor ? rest : fields;
          if (colors && avatarColor !== undefined)
            await runCauseEffect(remoteServers.setAgentColor(serverId, { agentId: input.agentId, color: avatarColor }));
          // The released agent route refuses a change without a profile field. When a colour went on its
          // own route above and nothing else changed, the agent is read again instead (#5708).
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
          // A hue alone removes the colour on the host. Read the colours again, so the answer has none.
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
          await openHttpLink(url, openExternal);
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
            ),
          ),
      }),
      searchConversationFiles: payloadHandler(parseSearchConversationFiles, (parsed) =>
        host.searchAgentConversationFiles(parsed.query, parsed.cursor, parsed.limit),
      ),
      listConversationReads: scopedQueryHandler({
        local: () => host.listAgentConversationReads(),
        remote: (serverId) => runCauseEffect(remoteServers.listAgentConversationReads(serverId)),
      }),
      markConversationRead: scopedHandler(parseMarkConversationRead, {
        local: (parsed) => runCauseEffect(host.markAgentConversationRead(parsed)),
        remote: (parsed, serverId) => runCauseEffect(remoteServers.markAgentConversationRead(parsed, serverId)),
      }),
      markConversationUnread: scopedHandler(parseMarkConversationUnread, {
        local: (parsed) => runCauseEffect(host.markAgentConversationUnread(parsed)),
        // A joined server marks one message unread through `conversation-unread-from-v1`.
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
      // The user of this computer can delete any message of a local agent.
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
              // The host uses this computer's zone for a routine the agent creates from the message.
              body: { ...input, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
            }),
          );
        },
      }),
      setMessageReaction: scopedHandler(parseMessageReaction, {
        local: (parsed) => runCauseEffect(service.setMessageReaction(parsed)),
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
      // Open waits are local only: the Team API has no route for them.
      listWaits: scopedHandler(parseAgentId, {
        local: (agentId) => service.listWaits(agentId),
        remote: (agentId) => ({ agentId, waits: [] }),
      }),
      cancelWait: scopedHandler(parseCancelAgentWait, {
        local: (parsed) => service.cancelWait(parsed.agentId, parsed.waitId),
        remote: () => {
          throw new Error(sourceText("error.backend.agentWaitRemoteUnsupported"));
        },
      }),
      // A joined server has tasks through `agent-tasks-v1`. A server without it shows no task. A server
      // with `agent-thread-branches-v1` also gives the branch links, read after the tasks so that each
      // listed branch has its link.
      listTasks: scopedHandler(parseAgentId, {
        local: (agentId) => service.listTasks(agentId),
        remote: (agentId, serverId) => {
          if (!remoteServers.supportsCapability(serverId, AGENT_TASKS_CAPABILITY))
            return { agentId, tasks: [], limit: 1 };
          const init = { method: "POST", body: { agentId } } as const;
          const tasks = remoteServers.request(serverId, AGENT_TASKS_ROUTES.list, decodeRemoteAgentTasks, init);
          if (!remoteServers.supportsCapability(serverId, AGENT_THREAD_BRANCHES_CAPABILITY))
            return runCauseEffect(tasks);
          return runCauseEffect(
            Effect.gen(function* () {
              const snapshot = yield* tasks;
              const links = yield* remoteServers.request(
                serverId,
                AGENT_THREAD_BRANCHES_ROUTES.list,
                decodeRemoteAgentThreadBranches,
                init,
              );
              return withAgentThreadBranches(snapshot, links.branches);
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
      // Local only: `agent-tasks-v1` does not move a queued message into a task.
      runQueuedMessageAsTask: scopedHandler(parseRunQueuedMessageAsTask, {
        local: (parsed) => runCauseEffect(service.runQueuedMessageAsTask(parsed)),
        remote: taskRemoteUnsupported,
      }),
      // A joined server branches through `agent-thread-branches-v1`; an older one cannot branch.
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
      // A joined server renames and deletes through `agent-threads-v1`; `agent-tasks-v1` has neither.
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
      // A joined server keeps the member's read marks through `agent-thread-reads-v1`. A server
      // without it has no marks, so no thread shows as unread.
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
          // `agent-tasks-v1` sends no thread queue, so only a thread on this computer has an order to change.
          if (parsed.taskId !== undefined) throw new Error(sourceText("error.backend.threadRemoteUnsupported"));
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
          // The context-reset-v1 codec has already checked the empty reply.
          await runCauseEffect(
            remoteServers.request(serverId, CONTEXT_RESET_ROUTES.clear, () => undefined, {
              method: "POST",
              body: { agentId },
            }),
          );
        },
      }),
      // A joined server deletes an agent's history with `chat-history-v1`.
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
      // A joined server compacts with `context-compact-v1`.
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
      respondToBrowserSecret: scopedHandler(parseLocalBrowserSecretResponse, {
        local: (parsed) => runCauseEffect(service.respondToBrowserSecret(parsed)),
        remote: (parsed, serverId) => {
          // A save goes to the Vault of the joined server, on the route that only its owner or an admin can use.
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
