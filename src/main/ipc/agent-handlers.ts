import { AGENT_HIDDEN_CAPABILITY, AGENT_HIDDEN_ROUTES } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import {
  AGENT_SESSION_SETTINGS_CAPABILITY,
  AGENT_SESSION_SETTINGS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-session-settings-v1";
import {
  BROWSER_SECRET_VAULT_CAPABILITY,
  BROWSER_SECRET_VAULT_ROUTES,
} from "@openbot/contracts/team-protocol/browser-secret-vault-v1";
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
  decodeAgentProfileDraft,
  decodeChannel,
  decodeChannelPage,
  decodeChannelSummaries,
  decodeSaveAgentProfileResult,
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
  parseSetAgentHiddenInput,
  parseSetAgentNotificationLevelInput,
  parseSetAgentSessionSetting,
  remoteBrowserSecretResponse,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_TASKS_CAPABILITY, AGENT_TASKS_ROUTES } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import {
  AGENT_THREAD_FILES_CAPABILITY,
  AGENT_THREAD_FILES_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-files-v1";
import {
  AGENT_THREAD_READS_CAPABILITY,
  AGENT_THREAD_READS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-reads-v1";
import { AGENT_THREADS_CAPABILITY, AGENT_THREADS_ROUTES } from "@openbot/contracts/team-protocol/agent-threads-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { CONTEXT_RESET_CAPABILITY, CONTEXT_RESET_ROUTES } from "@openbot/contracts/team-protocol/context-reset-v1";
import {
  PROVIDER_ACCOUNTS_CAPABILITY,
  PROVIDER_ACCOUNTS_ROUTES,
} from "@openbot/contracts/team-protocol/provider-accounts-v1";
import {
  decodeSideQuestionResponse,
  SIDE_QUESTION_CAPABILITY,
  SIDE_QUESTION_ROUTES,
} from "@openbot/contracts/team-protocol/side-question-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { duplicateAgentIntoLayout } from "../../backend/agent/duplication-gate";
import type { AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { SidebarLayoutStore } from "../../backend/sidebar-layout-store";
import type { HostService } from "../host-service";
import { type MessageLinkRelay, openHttpLink } from "../message-link-relay";
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
  decodeRemoteTaskConversation,
  decodeRemoteTaskReadState,
  decodeSidebarLayoutSnapshot,
} from "../remote-agent-decoding";
import { acceptEmpty, decodeVoid, type ResponseDecoder } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import type { SkillMarketplaceService } from "../skill-marketplace-service";
import {
  parseAcknowledgeFailedTurn,
  parseAgentId,
  parseAgentTask,
  parseApprovalResponse,
  parseBrowserTakeoverResponse,
  parseCancelAgentWait,
  parseCancelMessageLink,
  parseCancelQueuedMessage,
  parseChannelId,
  parseCreateAgent,
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
  parseReadConversationPage,
  parseRenameAgentTask,
  parseReorderQueue,
  parseRunQueuedMessageAsTask,
  parseSearchConversationFiles,
  parseSearchConversationMessages,
  parseSendMessage,
  parseSetAgentAvatar,
  parseSidebarLayoutAction,
  parseStartAgentTask,
  parseSteerQueuedMessage,
  parseUpdateAgent,
  parseUpdateQueuedMessage,
} from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

/** Its lines also go to the provider log. See `PROVIDER_LOG_PREFIXES`. */
const modelLogger = createOpenBotLogger("provider-models");

/** A joined server without `agent-tasks-v1`, or a task request that it cannot carry, fails with a reason. */
function taskRemoteUnsupported(): never {
  throw new Error(sourceText("error.backend.threadRemoteUnsupported"));
}

/**
 * The body of an `agent-tasks-v1` request: the agent, with the task, the text of a start or message, or
 * both. Only the `agent-thread-files-v1` routes carry `attachmentDraftIds`.
 */
interface RemoteTaskBody {
  agentId: string;
  taskId?: string;
  text?: string;
  attachmentDraftIds?: string[];
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
  host: HostService;
  remoteServers: RemoteServerManager;
  skills: SkillMarketplaceService;
  messageLinks: MessageLinkRelay;
  openExternal: (url: string) => Promise<void>;
}

export function agentIpcHandlers({
  service,
  sidebarLayout,
  host,
  remoteServers,
  skills,
  messageLinks,
  openExternal,
}: AgentIpcDependencies): Pick<IpcGroupHandlers, "agent"> {
  const remoteTaskRequest = <T>(serverId: string, path: string, decoder: ResponseDecoder<T>, body: RemoteTaskBody) => {
    if (!remoteServers.supportsCapability(serverId, AGENT_TASKS_CAPABILITY)) taskRemoteUnsupported();
    // `agent-tasks-v1` carries text only; a host with `agent-thread-files-v1` takes files on its own routes.
    if (body.attachmentDraftIds?.length && !remoteServers.supportsCapability(serverId, AGENT_THREAD_FILES_CAPABILITY))
      taskRemoteUnsupported();
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  };
  const remoteThreadRequest = (serverId: string, path: string, body: AgentTaskInput & { title?: string }) => {
    if (!remoteServers.supportsCapability(serverId, AGENT_THREADS_CAPABILITY)) taskRemoteUnsupported();
    return runCauseEffect(remoteServers.request(serverId, path, acceptEmpty, { method: "POST", body }));
  };
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
        local: () => logRejectedModels(service.listModels(), "local"),
        remote: (serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agents.models, (value) =>
              decodeAgentModelOptions(logRejectedModels(value, "remote")),
            ),
          ),
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
        remote: (serverId) =>
          runCauseEffect(remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries)),
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
      getSidebarLayout: scopedQueryHandler({
        local: () => sidebarLayout.getSnapshot(),
        remote: (serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.sidebarLayout.state, decodeSidebarLayoutSnapshot),
          ),
      }),
      mutateSidebarLayout: scopedHandler(parseSidebarLayoutAction, {
        local: (action) => runCauseEffect(sidebarLayout.mutate(action, service.sidebarChatIds())),
        remote: (action, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.sidebarLayout.actions, decodeSidebarLayoutSnapshot, {
              method: "POST",
              body: action,
            }),
          ),
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
      saveProfile: scopedHandler(parseSaveAgentProfile, {
        local: (input) => runCauseEffect(service.saveProfile(input, sidebarLayout, host.conversationSender())),
        remote: (input, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agents.saveProfile, decodeSaveAgentProfileResult, {
              method: "POST",
              body: input,
            }),
          ),
      }),
      createAgent: scopedHandler(parseCreateAgent, {
        local: (parsed) => runCauseEffect(service.createAgent(parsed, undefined, undefined, host.conversationSender())),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummary, {
              method: "POST",
              body: parsed,
            }),
          ),
      }),
      duplicateAgent: scopedHandler(parseAgentId, {
        local: (agentId) =>
          runCauseEffect(
            duplicateAgentIntoLayout(service, sidebarLayout, agentId, undefined, (copyId) =>
              host.copyAgentAccess(agentId, copyId),
            ),
          ),
        remote: (agentId, serverId) => runCauseEffect(remoteServers.duplicateAgent(agentId, serverId)),
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
          const { providerAccountId, ...update } = input;
          if (
            providerAccountId !== undefined &&
            !remoteServers.supportsCapability(serverId, PROVIDER_ACCOUNTS_CAPABILITY)
          )
            throw new Error(sourceText("error.team.providersUnsupported"));
          const agent = await runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.one(input.agentId), decodeAgentSummary, {
              method: "PATCH",
              body: update,
            }),
          );
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
        remote: () => {
          throw new Error(sourceText("error.backend.markUnreadRemoteUnsupported"));
        },
      }),
      sendMessage: scopedHandler(parseSendMessage, {
        local: (input) => runCauseEffect(service.sendMessage(input, host.conversationSender())),
        remote: (input, serverId) => {
          if (input.taskId) {
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
      // A joined server has tasks through `agent-tasks-v1`. A server without it shows no task.
      listTasks: scopedHandler(parseAgentId, {
        local: (agentId) => service.listTasks(agentId),
        remote: (agentId, serverId) =>
          remoteServers.supportsCapability(serverId, AGENT_TASKS_CAPABILITY)
            ? runCauseEffect(
                remoteServers.request(serverId, AGENT_TASKS_ROUTES.list, decodeRemoteAgentTasks, {
                  method: "POST",
                  body: { agentId },
                }),
              )
            : { agentId, tasks: [], limit: 1 },
      }),
      readTask: scopedHandler(parseAgentTask, {
        local: (parsed) => service.readTask(parsed.agentId, parsed.taskId),
        remote: (parsed, serverId) =>
          remoteTaskRequest(serverId, AGENT_TASKS_ROUTES.read, decodeRemoteTaskConversation, agentTaskBody(parsed)),
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
      // A joined server keeps the member's read marks through `agent-thread-reads-v1`.
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
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.queueReorder(parsed.agentId), decodeVoid, {
              method: "POST",
              body: { deliveryIds: parsed.deliveryIds },
            }),
          ),
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
      // Local only: the Team API has no route, and a joined server's agent shows no context ring.
      compactContext: scopedHandler(parseAgentId, {
        local: (agentId) => runCauseEffect(service.compactAgentContext(agentId)),
        remote: () => {
          throw new Error(sourceText("error.team.contextCompactUnsupported"));
        },
      }),
      compactTaskContext: scopedHandler(parseAgentTask, {
        local: (parsed) => runCauseEffect(service.compactTaskContext(parsed)),
        remote: () => {
          throw new Error(sourceText("error.team.contextCompactUnsupported"));
        },
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
