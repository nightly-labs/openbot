// An agent's core surface: status, agents, conversations, the queue and the prompts
// a turn can raise. Memories, routines and attachments are their own registrars.
// Every one of these routes to the local service or to a remote server by the
// `serverId` in the request.

import {
  analyticsQuery,
  assertAnalyticsScope,
  assertHostAnalyticsScope,
  BROWSER_SECRET_RESPONSE_PATH,
  CHANNEL_DELETE_CAPABILITY,
  decodeAgentProfileDraft,
  decodeChannel,
  decodeChannelPage,
  decodeChannelSummaries,
  decodeSaveAgentProfileResult,
  hostAnalyticsQuery,
  isAgentModelOption,
  parseAgentAnalyticsInput,
  parseBrowserSecretResponse,
  parseChannelCommand,
  parseChannelRead,
  parseGenerateAgentProfile,
  parseHostAnalyticsInput,
  parseSaveAgentProfile,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { CONTEXT_RESET_CAPABILITY, CONTEXT_RESET_ROUTES } from "@openbot/contracts/team-protocol/context-reset-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { duplicateAgentIntoLayout } from "../../backend/agent/duplication-gate";
import type { AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { SidebarLayoutStore } from "../../backend/sidebar-layout-store";
import type { HostService } from "../host-service";
import {
  decodeAccountUsageFromHost,
  decodeAgentAnalyticsFromHost,
  decodeAgentModelOptions,
  decodeAgentStatusFromHost,
  decodeAgentSummaries,
  decodeAgentSummary,
  decodeHostAnalyticsFromHost,
  decodeInstalledSkillsFromHost,
  decodeQueuedMessageReceipt,
  decodeQueueSnapshot,
  decodeSidebarLayoutSnapshot,
} from "../remote-agent-decoding";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import type { SkillMarketplaceService } from "../skill-marketplace-service";
import {
  parseAcknowledgeFailedTurn,
  parseAgentId,
  parseApprovalResponse,
  parseBrowserTakeoverResponse,
  parseCancelQueuedMessage,
  parseChannelId,
  parseCreateAgent,
  parseInterrupt,
  parseMarkConversationRead,
  parseMessageReaction,
  parseOptionalAgentId,
  parsePromptResponse,
  parseQueueEdit,
  parseReadConversationPage,
  parseReorderQueue,
  parseSearchConversationFiles,
  parseSearchConversationMessages,
  parseSendMessage,
  parseSetAgentAvatar,
  parseSidebarLayoutAction,
  parseSteerQueuedMessage,
  parseUpdateAgent,
  parseUpdateQueuedMessage,
} from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

/** Its lines also go to the provider log. See `PROVIDER_LOG_PREFIXES`. */
const modelLogger = createOpenBotLogger("provider-models");

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
}

export function agentIpcHandlers({
  service,
  sidebarLayout,
  host,
  remoteServers,
  skills,
}: AgentIpcDependencies): Pick<IpcGroupHandlers, "agent"> {
  return {
    agent: {
      getStatus: scopedQueryHandler({
        local: () => service.getStatus(),
        remote: (serverId) =>
          runCauseEffect(remoteServers.request(serverId, TEAM_API_ROUTES.agents.status, decodeAgentStatusFromHost)),
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
        local: (agentId) => runCauseEffect(duplicateAgentIntoLayout(service, sidebarLayout, agentId)),
        remote: (agentId, serverId) => runCauseEffect(remoteServers.duplicateAgent(agentId, serverId)),
      }),
      updateAgent: scopedHandler(parseUpdateAgent, {
        local: (input) => runCauseEffect(service.updateAgent(input)),
        remote: (input, serverId) => {
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
          return runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.one(input.agentId), decodeAgentSummary, {
              method: "PATCH",
              body: input,
            }),
          );
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
      searchConversationMessages: scopedHandler(parseSearchConversationMessages, {
        local: (parsed) =>
          host.searchAgentConversationMessages(parsed.query, parsed.agentId, parsed.cursor, parsed.limit),
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
      sendMessage: scopedHandler(parseSendMessage, {
        local: (input) => runCauseEffect(service.sendMessage(input, host.conversationSender())),
        remote: (input, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.messages(input.agentId), decodeQueuedMessageReceipt, {
              method: "POST",
              // The host uses this computer's zone for a routine the agent creates from the message.
              body: { ...input, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
            }),
          ),
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
      respondToBrowserSecret: scopedHandler(parseBrowserSecretResponse, {
        local: (parsed) => runCauseEffect(service.respondToBrowserSecret(parsed)),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, BROWSER_SECRET_RESPONSE_PATH, decodeVoid, { method: "POST", body: parsed }),
          ),
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
