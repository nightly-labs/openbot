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
  parseAgentAnalyticsInput,
  parseBrowserSecretResponse,
  parseChannelCommand,
  parseChannelRead,
  parseGenerateAgentProfile,
  parseHostAnalyticsInput,
  parseSaveAgentProfile,
} from "@openbot/contracts/ipc";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { decodeAgentAnalyticsFromHost, decodeHostAnalyticsFromHost } from "../remote-agent-decoding";
// An agent's core surface: status, agents, conversations, the queue and the prompts
// a turn can raise. Memories, routines and attachments are their own registrars.
// Every one of these routes to the local service or to a remote server by the
// `serverId` in the request.

import type {
  DuplicateAgentResult,
  SendMessageInput,
  SidebarLayoutSnapshot,
  UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { AgentService } from "../../backend/agent-service";
import type { SidebarLayoutStore } from "../../backend/sidebar-layout-store";
import type { HostService } from "../host-service";
import {
  decodeAccountUsageFromHost,
  decodeAgentModelOptions,
  decodeAgentStatusFromHost,
  decodeAgentSummaries,
  decodeAgentSummary,
  decodeInstalledSkillsFromHost,
  decodeQueuedMessageReceipt,
  decodeQueueSnapshot,
  decodeSidebarLayoutSnapshot,
} from "../remote-agent-decoding";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import type { SkillMarketplaceService } from "../skill-marketplace-service";
import {
  agentRequest,
  agentScope,
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
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";

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
      getStatus: payloadHandler(agentScope, (parsed) => {
        return routeToServer(parsed.serverId, {
          local: () => service.getStatus(),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agents.status, decodeAgentStatusFromHost),
        });
      }),
      getHostAnalytics: payloadHandler(agentRequest(parseHostAnalyticsInput), (parsed) => {
        const input = parsed.payload;
        return routeToServer(parsed.serverId, {
          local: () => service.getHostAnalytics(input),
          remote: (serverId) =>
            remoteServers.supportsCapability(serverId, "host-analytics")
              ? remoteServers.request(serverId, `${TEAM_API_ROUTES.analytics}?${hostAnalyticsQuery(input)}`, (value) =>
                  assertHostAnalyticsScope(decodeHostAnalyticsFromHost(value), input),
                )
              : null,
        });
      }),
      getAnalytics: payloadHandler(agentRequest(parseAgentAnalyticsInput), (parsed) => {
        const input = parsed.payload;
        return routeToServer(parsed.serverId, {
          local: () => service.getAnalytics(input),
          remote: (serverId) =>
            remoteServers.supportsCapability(serverId, "agent-analytics")
              ? remoteServers.request(
                  serverId,
                  `${TEAM_API_ROUTES.agent.analytics(input.agentId)}?${analyticsQuery(input)}`,
                  (value) => assertAnalyticsScope(decodeAgentAnalyticsFromHost(value), input),
                )
              : null,
        });
      }),
      getUsage: payloadHandler(agentRequest(parseOptionalAgentId), (parsed) => {
        const agentId = parsed.payload;
        return routeToServer(parsed.serverId, {
          local: () => service.getUsage(agentId),
          remote: (serverId) =>
            agentId
              ? remoteServers.supportsCapability(serverId, "model-scoped-usage")
                ? remoteServers.request(serverId, TEAM_API_ROUTES.agent.usage(agentId), decodeAccountUsageFromHost)
                : { limits: [] }
              : remoteServers.request(serverId, TEAM_API_ROUTES.agents.usage, decodeAccountUsageFromHost),
        });
      }),
      listModels: payloadHandler(agentScope, (parsed) => {
        return routeToServer(parsed.serverId, {
          local: () => service.listModels(),
          remote: (serverId) => remoteServers.request(serverId, TEAM_API_ROUTES.agents.models, decodeAgentModelOptions),
        });
      }),
      listAgents: payloadHandler(agentScope, (parsed) => {
        return routeToServer(parsed.serverId, {
          local: () => service.listAgents(),
          remote: (serverId) => remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries),
        });
      }),
      listInstalledSkills: payloadHandler(agentRequest(parseAgentId), (scoped) => {
        const agentId = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => skills.listInstalledForChatTags(agentId),
          // A server too old to know the endpoint would answer 404, so ask its advertised capabilities first.
          remote: (serverId) =>
            remoteServers
              .list()
              .find((server) => server.id === serverId)
              ?.compatibility?.capabilities.includes("installed-skills")
              ? remoteServers.request(serverId, TEAM_API_ROUTES.agent.skills(agentId), decodeInstalledSkillsFromHost)
              : Promise.resolve([]),
        });
      }),
      listChannels: payloadHandler(agentScope, (scoped) =>
        routeToServer(scoped.serverId, {
          // The reader here is the host user of this computer, so messages they wrote before they
          // signed in are their own.
          local: () => service.channels.store.list(host.channelActor().id, true),
          remote: (serverId) => remoteServers.request(serverId, CHANNEL_ROUTES.list, decodeChannelSummaries),
        }),
      ),
      readChannel: payloadHandler(agentRequest(parseChannelRead), (scoped) => {
        const input = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.channels.store.page(input.channelId, input.beforeSequence),
          remote: (serverId) =>
            remoteServers.request(serverId, CHANNEL_ROUTES.read, decodeChannelPage, { method: "POST", body: input }),
        });
      }),
      channelCommand: payloadHandler(agentRequest(parseChannelCommand), (scoped) => {
        const input = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.channels.command(input, host.channelActor()),
          remote: (serverId) =>
            remoteServers.request(serverId, CHANNEL_ROUTES.command, decodeChannel, { method: "POST", body: input }),
        });
      }),
      deleteChannel: payloadHandler(agentRequest(parseChannelId), (scoped) => {
        const channelId = scoped.payload;
        return routeToServer<void>(scoped.serverId, {
          local: () => service.deleteChannel(channelId),
          remote: async (serverId) => {
            if (!remoteServers.supportsCapability(serverId, CHANNEL_DELETE_CAPABILITY))
              throw new Error("Channel deletion is not supported by this server.");
            await remoteServers.request(serverId, CHANNEL_ROUTES.delete, decodeVoid, {
              method: "POST",
              body: { channelId },
            });
          },
        });
      }),
      getSidebarLayout: payloadHandler(agentScope, (parsed): Promise<SidebarLayoutSnapshot> => {
        return routeToServer(parsed.serverId, {
          local: () => sidebarLayout.getSnapshot(),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.sidebarLayout.state, decodeSidebarLayoutSnapshot),
        });
      }),
      mutateSidebarLayout: payloadHandler(
        agentRequest(parseSidebarLayoutAction),
        (scoped): Promise<SidebarLayoutSnapshot> => {
          const action = scoped.payload;
          return routeToServer(scoped.serverId, {
            local: () => sidebarLayout.mutate(action, service.sidebarChatIds()),
            remote: (serverId) =>
              remoteServers.request(serverId, TEAM_API_ROUTES.sidebarLayout.actions, decodeSidebarLayoutSnapshot, {
                method: "POST",
                body: action,
              }),
          });
        },
      ),
      generateProfile: payloadHandler(agentRequest(parseGenerateAgentProfile), (scoped) => {
        const input = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.generateProfile(input, sidebarLayout.getSnapshot().sections),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agents.generateProfile, decodeAgentProfileDraft, {
              method: "POST",
              body: input,
              timeoutMs: 150_000,
            }),
        });
      }),
      saveProfile: payloadHandler(agentRequest(parseSaveAgentProfile), (scoped) => {
        const input = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.saveProfile(input, sidebarLayout),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agents.saveProfile, decodeSaveAgentProfileResult, {
              method: "POST",
              body: input,
            }),
        });
      }),
      createAgent: payloadHandler(agentRequest(parseCreateAgent), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.createAgent(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummary, {
              method: "POST",
              body: parsed,
            }),
        });
      }),
      duplicateAgent: payloadHandler(agentRequest(parseAgentId), (scoped): Promise<DuplicateAgentResult> => {
        const agentId = scoped.payload;
        return routeDuplicateAgent(service, sidebarLayout, remoteServers, scoped.serverId, agentId);
      }),
      updateAgent: payloadHandler(agentRequest(parseUpdateAgent), (scoped) => {
        return routeUpdateAgent(service, remoteServers, scoped.serverId, scoped.payload);
      }),
      setAvatar: payloadHandler(agentRequest(parseSetAgentAvatar), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.setAvatar(parsed.agentId, parsed.image),
          remote: (serverId) => remoteServers.setAgentAvatar(parsed.agentId, parsed.image, serverId),
        });
      }),
      deleteAgent: payloadHandler(agentRequest(parseAgentId), (scoped) => {
        const agentId = scoped.payload;
        return routeDeleteAgent(service, sidebarLayout, remoteServers, scoped.serverId, agentId);
      }),
      readConversation: payloadHandler(agentRequest(parseAgentId), (scoped) => {
        return routeReadConversation(host, remoteServers, scoped.serverId, scoped.payload);
      }),
      readConversationPage: payloadHandler(agentRequest(parseReadConversationPage), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => host.readAgentConversationPage(parsed.agentId, parsed.anchor, parsed.limit),
          remote: (serverId) =>
            remoteServers.readAgentConversationPage(parsed.agentId, parsed.anchor, parsed.limit, serverId),
        });
      }),
      searchConversationMessages: payloadHandler(agentRequest(parseSearchConversationMessages), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => host.searchAgentConversationMessages(parsed.query, parsed.agentId, parsed.cursor, parsed.limit),
          remote: (serverId) =>
            remoteServers.searchAgentConversationMessages(
              parsed.query,
              parsed.agentId,
              parsed.cursor,
              parsed.limit,
              serverId,
            ),
        });
      }),
      listConversationReads: payloadHandler(agentScope, (parsed) => {
        return routeToServer(parsed.serverId, {
          local: () => host.listAgentConversationReads(),
          remote: (serverId) => remoteServers.listAgentConversationReads(serverId),
        });
      }),
      markConversationRead: payloadHandler(agentRequest(parseMarkConversationRead), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => host.markAgentConversationRead(parsed),
          remote: (serverId) => remoteServers.markAgentConversationRead(parsed, serverId),
        });
      }),
      sendMessage: payloadHandler(agentRequest(parseSendMessage), (scoped) => {
        return routeSendMessage(service, remoteServers, scoped.serverId, scoped.payload);
      }),
      setMessageReaction: payloadHandler(agentRequest(parseMessageReaction), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.setMessageReaction(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.reactions(parsed.agentId), decodeVoid, {
              method: "POST",
              body: parsed,
            }),
        });
      }),
      listQueue: payloadHandler(agentRequest(parseAgentId), (scoped) => {
        return routeListQueue(service, remoteServers, scoped.serverId, scoped.payload);
      }),
      acknowledgeFailedTurn: payloadHandler(agentRequest(parseAcknowledgeFailedTurn), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.acknowledgeFailedTurn(parsed.agentId, parsed.turnId),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.failuresAcknowledge(parsed.agentId), decodeVoid, {
              method: "POST",
              body: { turnId: parsed.turnId },
            }),
        });
      }),
      cancelQueuedMessage: payloadHandler(agentRequest(parseCancelQueuedMessage), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.cancelQueuedMessage(parsed.agentId, parsed.deliveryId),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.queueCancel(parsed.agentId), decodeVoid, {
              method: "POST",
              body: { deliveryId: parsed.deliveryId },
            }),
        });
      }),
      steerQueuedMessage: payloadHandler(agentRequest(parseSteerQueuedMessage), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.steerQueuedMessage(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.queueSteer(parsed.agentId), decodeVoid, {
              method: "POST",
              body: { deliveryId: parsed.deliveryId, expectedTurnId: parsed.expectedTurnId },
            }),
        });
      }),
      editQueuedMessage: payloadHandler(agentRequest(parseQueueEdit), (scoped) => {
        const { agentId, ...input } = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.editQueuedMessage(agentId, input),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.queueEdit(agentId), decodeQueueSnapshot, {
              method: "POST",
              body: { ...input },
            }),
        });
      }),
      updateQueuedMessage: payloadHandler(agentRequest(parseUpdateQueuedMessage), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.updateQueuedMessage(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.queueUpdate(parsed.agentId), decodeVoid, {
              method: "POST",
              body: {
                deliveryId: parsed.deliveryId,
                text: parsed.text,
                keepAttachmentIds: parsed.keepAttachmentIds,
                attachmentDraftIds: parsed.attachmentDraftIds,
              },
            }),
        });
      }),
      reorderQueue: payloadHandler(agentRequest(parseReorderQueue), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.reorderQueue(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.queueReorder(parsed.agentId), decodeVoid, {
              method: "POST",
              body: { deliveryIds: parsed.deliveryIds },
            }),
        });
      }),
      interrupt: payloadHandler(agentRequest(parseInterrupt), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.interrupt(parsed.agentId, parsed.turnId),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.interrupt(parsed.agentId), decodeVoid, {
              method: "POST",
              body: { turnId: parsed.turnId },
            }),
        });
      }),
      respondToPrompt: payloadHandler(agentRequest(parsePromptResponse), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.respondToPrompt(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.respond.prompt, decodeVoid, {
              method: "POST",
              body: parsed,
            }),
        });
      }),
      respondToApproval: payloadHandler(agentRequest(parseApprovalResponse), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.respondToApproval(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.respond.approval, decodeVoid, {
              method: "POST",
              body: parsed,
            }),
        });
      }),
      respondToBrowserSecret: payloadHandler(agentRequest(parseBrowserSecretResponse), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.respondToBrowserSecret(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, BROWSER_SECRET_RESPONSE_PATH, decodeVoid, { method: "POST", body: parsed }),
        });
      }),
      respondToBrowserTakeover: payloadHandler(agentRequest(parseBrowserTakeoverResponse), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.respondToBrowserTakeover(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.respond.browserTakeover, decodeVoid, {
              method: "POST",
              body: parsed,
            }),
        });
      }),
    },
  };
}

function routeUpdateAgent(
  service: AgentService,
  remoteServers: RemoteServerManager,
  serverId: string,
  input: UpdateAgentInput,
) {
  return routeToServer(serverId, {
    local: () => service.updateAgent(input),
    remote: (target) => {
      // The Team API does not carry access, and a team member must not be able to widen it.
      if (input.access !== undefined) {
        throw new Error("Agent access can only be changed on the computer that runs the agent.");
      }
      return remoteServers.request(target, TEAM_API_ROUTES.agent.one(input.agentId), decodeAgentSummary, {
        method: "PATCH",
        body: input,
      });
    },
  });
}

function routeDeleteAgent(
  service: AgentService,
  sidebarLayout: SidebarLayoutStore,
  remoteServers: RemoteServerManager,
  serverId: string,
  agentId: string,
): Promise<void> {
  return routeToServer<void>(serverId, {
    local: async () => {
      await service.deleteAgent(agentId);
      await sidebarLayout.removeAgent(agentId);
    },
    remote: async (target) => {
      await remoteServers.request(target, TEAM_API_ROUTES.agent.one(agentId), decodeVoid, { method: "DELETE" });
    },
  });
}

function routeDuplicateAgent(
  service: AgentService,
  sidebarLayout: SidebarLayoutStore,
  remoteServers: RemoteServerManager,
  serverId: string,
  agentId: string,
): Promise<DuplicateAgentResult> {
  return routeToServer(serverId, {
    local: () => duplicateAgentLocally(service, sidebarLayout, agentId),
    remote: (target) => remoteServers.duplicateAgent(agentId, target),
  });
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

function routeReadConversation(
  host: HostService,
  remoteServers: RemoteServerManager,
  serverId: string,
  agentId: string,
) {
  return routeToServer(serverId, {
    local: () => host.readAgentConversation(agentId),
    remote: (target) => remoteServers.readAgentConversation(agentId, target),
  });
}

function routeSendMessage(
  service: AgentService,
  remoteServers: RemoteServerManager,
  serverId: string,
  input: SendMessageInput,
) {
  return routeToServer(serverId, {
    local: () => service.sendMessage(input),
    remote: (target) =>
      remoteServers.request(target, TEAM_API_ROUTES.agent.messages(input.agentId), decodeQueuedMessageReceipt, {
        method: "POST",
        body: input,
      }),
  });
}

function routeListQueue(service: AgentService, remoteServers: RemoteServerManager, serverId: string, agentId: string) {
  return routeToServer(serverId, {
    local: () => service.listQueue(agentId),
    remote: (target) => remoteServers.request(target, TEAM_API_ROUTES.agent.queue(agentId), decodeQueueSnapshot),
  });
}
