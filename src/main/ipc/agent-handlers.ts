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
  type DuplicateAgentResult,
  decodeAgentProfileDraft,
  decodeChannel,
  decodeChannelPage,
  decodeChannelSummaries,
  decodeSaveAgentProfileResult,
  hostAnalyticsQuery,
  parseAgentAnalyticsInput,
  parseBrowserSecretResponse,
  parseChannelCommand,
  parseChannelRead,
  parseGenerateAgentProfile,
  parseHostAnalyticsInput,
  parseSaveAgentProfile,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import type { AgentService } from "../../backend/agent-service";
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
  parseSearchConversationMessages,
  parseSendMessage,
  parseSetAgentAvatar,
  parseSidebarLayoutAction,
  parseSteerQueuedMessage,
  parseUpdateAgent,
  parseUpdateQueuedMessage,
} from "./agent-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

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
        remote: (serverId) => remoteServers.request(serverId, TEAM_API_ROUTES.agents.status, decodeAgentStatusFromHost),
      }),
      getHostAnalytics: scopedHandler(parseHostAnalyticsInput, {
        local: (input) => service.getHostAnalytics(input),
        remote: (input, serverId) =>
          remoteServers.supportsCapability(serverId, "host-analytics")
            ? remoteServers.request(serverId, `${TEAM_API_ROUTES.analytics}?${hostAnalyticsQuery(input)}`, (value) =>
                assertHostAnalyticsScope(decodeHostAnalyticsFromHost(value), input),
              )
            : null,
      }),
      getAnalytics: scopedHandler(parseAgentAnalyticsInput, {
        local: (input) => service.getAnalytics(input),
        remote: (input, serverId) =>
          remoteServers.supportsCapability(serverId, "agent-analytics")
            ? remoteServers.request(
                serverId,
                `${TEAM_API_ROUTES.agent.analytics(input.agentId)}?${analyticsQuery(input)}`,
                (value) => assertAnalyticsScope(decodeAgentAnalyticsFromHost(value), input),
              )
            : null,
      }),
      getUsage: scopedHandler(parseOptionalAgentId, {
        local: (agentId) => service.getUsage(agentId),
        remote: (agentId, serverId) =>
          agentId
            ? remoteServers.supportsCapability(serverId, "model-scoped-usage")
              ? remoteServers.request(serverId, TEAM_API_ROUTES.agent.usage(agentId), decodeAccountUsageFromHost)
              : { limits: [] }
            : remoteServers.request(serverId, TEAM_API_ROUTES.agents.usage, decodeAccountUsageFromHost),
      }),
      listModels: scopedQueryHandler({
        local: () => service.listModels(),
        remote: (serverId) => remoteServers.request(serverId, TEAM_API_ROUTES.agents.models, decodeAgentModelOptions),
      }),
      listAgents: scopedQueryHandler({
        local: () => service.listAgents(),
        remote: (serverId) => remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries),
      }),
      listInstalledSkills: scopedHandler(parseAgentId, {
        local: (agentId) => skills.listInstalledForChatTags(agentId),
        // A server too old to know the endpoint would answer 404, so ask its advertised capabilities first.
        remote: (agentId, serverId) =>
          remoteServers
            .list()
            .find((server) => server.id === serverId)
            ?.compatibility?.capabilities.includes("installed-skills")
            ? remoteServers.request(serverId, TEAM_API_ROUTES.agent.skills(agentId), decodeInstalledSkillsFromHost)
            : Promise.resolve([]),
      }),
      listChannels: scopedQueryHandler({
        // The reader here is the host user of this computer, so messages they wrote before they
        // signed in are their own.
        local: () => service.channels.store.list(host.channelActor().id, true),
        remote: (serverId) => remoteServers.request(serverId, CHANNEL_ROUTES.list, decodeChannelSummaries),
      }),
      readChannel: scopedHandler(parseChannelRead, {
        local: (input) => service.channels.store.page(input.channelId, input.beforeSequence),
        remote: (input, serverId) =>
          remoteServers.request(serverId, CHANNEL_ROUTES.read, decodeChannelPage, { method: "POST", body: input }),
      }),
      channelCommand: scopedHandler(parseChannelCommand, {
        local: (input) => service.channels.command(input, host.channelActor()),
        remote: (input, serverId) =>
          remoteServers.request(serverId, CHANNEL_ROUTES.command, decodeChannel, { method: "POST", body: input }),
      }),
      deleteChannel: scopedHandler(parseChannelId, {
        local: (channelId) => service.deleteChannel(channelId),
        remote: async (channelId, serverId) => {
          if (!remoteServers.supportsCapability(serverId, CHANNEL_DELETE_CAPABILITY))
            throw new Error("Channel deletion is not supported by this server.");
          await remoteServers.request(serverId, CHANNEL_ROUTES.delete, decodeVoid, {
            method: "POST",
            body: { channelId },
          });
        },
      }),
      getSidebarLayout: scopedQueryHandler({
        local: () => sidebarLayout.getSnapshot(),
        remote: (serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.sidebarLayout.state, decodeSidebarLayoutSnapshot),
      }),
      mutateSidebarLayout: scopedHandler(parseSidebarLayoutAction, {
        local: (action) => sidebarLayout.mutate(action, service.sidebarChatIds()),
        remote: (action, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.sidebarLayout.actions, decodeSidebarLayoutSnapshot, {
            method: "POST",
            body: action,
          }),
      }),
      generateProfile: scopedHandler(parseGenerateAgentProfile, {
        local: (input) => service.generateProfile(input, sidebarLayout.getSnapshot().sections),
        remote: (input, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agents.generateProfile, decodeAgentProfileDraft, {
            method: "POST",
            body: input,
            timeoutMs: 150_000,
          }),
      }),
      saveProfile: scopedHandler(parseSaveAgentProfile, {
        local: (input) => service.saveProfile(input, sidebarLayout),
        remote: (input, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agents.saveProfile, decodeSaveAgentProfileResult, {
            method: "POST",
            body: input,
          }),
      }),
      createAgent: scopedHandler(parseCreateAgent, {
        local: (parsed) => service.createAgent(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummary, {
            method: "POST",
            body: parsed,
          }),
      }),
      duplicateAgent: scopedHandler(parseAgentId, {
        local: (agentId) => duplicateAgentLocally(service, sidebarLayout, agentId),
        remote: (agentId, serverId) => remoteServers.duplicateAgent(agentId, serverId),
      }),
      updateAgent: scopedHandler(parseUpdateAgent, {
        local: (input) => service.updateAgent(input),
        remote: (input, serverId) => {
          // The Team API does not carry access, and a team member must not be able to widen it.
          if (input.access !== undefined) {
            throw new Error("Agent access can only be changed on the computer that runs the agent.");
          }
          return remoteServers.request(serverId, TEAM_API_ROUTES.agent.one(input.agentId), decodeAgentSummary, {
            method: "PATCH",
            body: input,
          });
        },
      }),
      setAvatar: scopedHandler(parseSetAgentAvatar, {
        local: (parsed) => service.setAvatar(parsed.agentId, parsed.image),
        remote: (parsed, serverId) => remoteServers.setAgentAvatar(parsed.agentId, parsed.image, serverId),
      }),
      deleteAgent: scopedHandler(parseAgentId, {
        local: async (agentId) => {
          await service.deleteAgent(agentId);
          await sidebarLayout.removeAgent(agentId);
        },
        remote: async (agentId, serverId) => {
          await remoteServers.request(serverId, TEAM_API_ROUTES.agent.one(agentId), decodeVoid, { method: "DELETE" });
        },
      }),
      readConversation: scopedHandler(parseAgentId, {
        local: (agentId) => host.readAgentConversation(agentId),
        remote: (agentId, serverId) => remoteServers.readAgentConversation(agentId, serverId),
      }),
      readConversationPage: scopedHandler(parseReadConversationPage, {
        local: (parsed) => host.readAgentConversationPage(parsed.agentId, parsed.anchor, parsed.limit),
        remote: (parsed, serverId) =>
          remoteServers.readAgentConversationPage(parsed.agentId, parsed.anchor, parsed.limit, serverId),
      }),
      searchConversationMessages: scopedHandler(parseSearchConversationMessages, {
        local: (parsed) =>
          host.searchAgentConversationMessages(parsed.query, parsed.agentId, parsed.cursor, parsed.limit),
        remote: (parsed, serverId) =>
          remoteServers.searchAgentConversationMessages(
            parsed.query,
            parsed.agentId,
            parsed.cursor,
            parsed.limit,
            serverId,
          ),
      }),
      listConversationReads: scopedQueryHandler({
        local: () => host.listAgentConversationReads(),
        remote: (serverId) => remoteServers.listAgentConversationReads(serverId),
      }),
      markConversationRead: scopedHandler(parseMarkConversationRead, {
        local: (parsed) => host.markAgentConversationRead(parsed),
        remote: (parsed, serverId) => remoteServers.markAgentConversationRead(parsed, serverId),
      }),
      sendMessage: scopedHandler(parseSendMessage, {
        local: (input) => service.sendMessage(input),
        remote: (input, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.messages(input.agentId), decodeQueuedMessageReceipt, {
            method: "POST",
            body: input,
          }),
      }),
      setMessageReaction: scopedHandler(parseMessageReaction, {
        local: (parsed) => service.setMessageReaction(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.reactions(parsed.agentId), decodeVoid, {
            method: "POST",
            body: parsed,
          }),
      }),
      listQueue: scopedHandler(parseAgentId, {
        local: (agentId) => service.listQueue(agentId),
        remote: (agentId, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.queue(agentId), decodeQueueSnapshot),
      }),
      acknowledgeFailedTurn: scopedHandler(parseAcknowledgeFailedTurn, {
        local: (parsed) => service.acknowledgeFailedTurn(parsed.agentId, parsed.turnId),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.failuresAcknowledge(parsed.agentId), decodeVoid, {
            method: "POST",
            body: { turnId: parsed.turnId },
          }),
      }),
      cancelQueuedMessage: scopedHandler(parseCancelQueuedMessage, {
        local: (parsed) => service.cancelQueuedMessage(parsed.agentId, parsed.deliveryId),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.queueCancel(parsed.agentId), decodeVoid, {
            method: "POST",
            body: { deliveryId: parsed.deliveryId },
          }),
      }),
      steerQueuedMessage: scopedHandler(parseSteerQueuedMessage, {
        local: (parsed) => service.steerQueuedMessage(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.queueSteer(parsed.agentId), decodeVoid, {
            method: "POST",
            body: { deliveryId: parsed.deliveryId, expectedTurnId: parsed.expectedTurnId },
          }),
      }),
      editQueuedMessage: scopedHandler(parseQueueEdit, {
        local: ({ agentId, ...input }) => service.editQueuedMessage(agentId, input),
        remote: ({ agentId, ...input }, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.queueEdit(agentId), decodeQueueSnapshot, {
            method: "POST",
            body: { ...input },
          }),
      }),
      updateQueuedMessage: scopedHandler(parseUpdateQueuedMessage, {
        local: (parsed) => service.updateQueuedMessage(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.queueUpdate(parsed.agentId), decodeVoid, {
            method: "POST",
            body: {
              deliveryId: parsed.deliveryId,
              text: parsed.text,
              keepAttachmentIds: parsed.keepAttachmentIds,
              attachmentDraftIds: parsed.attachmentDraftIds,
            },
          }),
      }),
      reorderQueue: scopedHandler(parseReorderQueue, {
        local: (parsed) => service.reorderQueue(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.queueReorder(parsed.agentId), decodeVoid, {
            method: "POST",
            body: { deliveryIds: parsed.deliveryIds },
          }),
      }),
      interrupt: scopedHandler(parseInterrupt, {
        local: (parsed) => service.interrupt(parsed.agentId, parsed.turnId),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.interrupt(parsed.agentId), decodeVoid, {
            method: "POST",
            body: { turnId: parsed.turnId },
          }),
      }),
      respondToPrompt: scopedHandler(parsePromptResponse, {
        local: (parsed) => service.respondToPrompt(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.respond.prompt, decodeVoid, {
            method: "POST",
            body: parsed,
          }),
      }),
      respondToApproval: scopedHandler(parseApprovalResponse, {
        local: (parsed) => service.respondToApproval(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.respond.approval, decodeVoid, {
            method: "POST",
            body: parsed,
          }),
      }),
      respondToBrowserSecret: scopedHandler(parseBrowserSecretResponse, {
        local: (parsed) => service.respondToBrowserSecret(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, BROWSER_SECRET_RESPONSE_PATH, decodeVoid, { method: "POST", body: parsed }),
      }),
      respondToBrowserTakeover: scopedHandler(parseBrowserTakeoverResponse, {
        local: (parsed) => service.respondToBrowserTakeover(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.respond.browserTakeover, decodeVoid, {
            method: "POST",
            body: parsed,
          }),
      }),
    },
  };
}

// The local copy is a two-store transaction: the agent, then its place in the sidebar. If placing it
// fails the half-made copy has to go, or the user is left with an agent they never asked for.
async function duplicateAgentLocally(
  service: AgentService,
  sidebarLayout: SidebarLayoutStore,
  agentId: string,
): Promise<DuplicateAgentResult> {
  const agent = await service.duplicateAgent(agentId);
  try {
    const layout = await sidebarLayout.placeDuplicateAfter(agentId, agent.id, [...service.sidebarChatIds(), agent.id]);
    return service.commitAgentDuplication(agent.id, layout);
  } catch (error) {
    const rollbackResults = await Promise.allSettled([
      service.deleteAgent(agent.id),
      sidebarLayout.removeAgent(agent.id),
    ]);
    const rollbackErrors = rollbackResults.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Agent duplication failed and the incomplete copy could not be removed.",
      );
    }
    throw error;
  }
}
