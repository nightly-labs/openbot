import { Effect } from "effect";
import type { RemoteWorkflowError } from "../remote-service-effects";
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
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agents.status, decodeAgentStatusFromHost)
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      getHostAnalytics: scopedHandler(parseHostAnalyticsInput, {
        local: (input) => service.getHostAnalytics(input),
        remote: (input, serverId) =>
          remoteServers.supportsCapability(serverId, "host-analytics")
            ? Effect.runPromise(
                remoteServers
                  .request(serverId, `${TEAM_API_ROUTES.analytics}?${hostAnalyticsQuery(input)}`, (value) =>
                    assertHostAnalyticsScope(decodeHostAnalyticsFromHost(value), input),
                  )
                  .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
              )
            : null,
      }),
      getAnalytics: scopedHandler(parseAgentAnalyticsInput, {
        local: (input) => service.getAnalytics(input),
        remote: (input, serverId) =>
          remoteServers.supportsCapability(serverId, "agent-analytics")
            ? Effect.runPromise(
                remoteServers
                  .request(
                    serverId,
                    `${TEAM_API_ROUTES.agent.analytics(input.agentId)}?${analyticsQuery(input)}`,
                    (value) => assertAnalyticsScope(decodeAgentAnalyticsFromHost(value), input),
                  )
                  .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
              )
            : null,
      }),
      getUsage: scopedHandler(parseOptionalAgentId, {
        local: (agentId) => Effect.runPromise(service.getUsage(agentId).pipe(Effect.mapError((error) => error.cause))),
        remote: (agentId, serverId) =>
          agentId
            ? remoteServers.supportsCapability(serverId, "model-scoped-usage")
              ? Effect.runPromise(
                  remoteServers
                    .request(serverId, TEAM_API_ROUTES.agent.usage(agentId), decodeAccountUsageFromHost)
                    .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
                )
              : { limits: [] }
            : Effect.runPromise(
                remoteServers
                  .request(serverId, TEAM_API_ROUTES.agents.usage, decodeAccountUsageFromHost)
                  .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
              ),
      }),
      listModels: scopedQueryHandler({
        local: () => logRejectedModels(service.listModels(), "local"),
        remote: (serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agents.models, (value) =>
                decodeAgentModelOptions(logRejectedModels(value, "remote")),
              )
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      listAgents: scopedQueryHandler({
        local: () => service.listAgents(),
        remote: (serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries)
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      listInstalledSkills: scopedHandler(parseAgentId, {
        local: (agentId) =>
          Effect.runPromise(skills.listInstalledForChatTags(agentId).pipe(Effect.mapError((error) => error.cause))),
        // A server too old to know the endpoint would answer 404, so ask its advertised capabilities first.
        remote: (agentId, serverId) =>
          remoteServers
            .list()
            .find((server) => server.id === serverId)
            ?.compatibility?.capabilities.includes("installed-skills")
            ? Effect.runPromise(
                remoteServers
                  .request(serverId, TEAM_API_ROUTES.agent.skills(agentId), decodeInstalledSkillsFromHost)
                  .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
              )
            : Promise.resolve([]),
      }),
      listChannels: scopedQueryHandler({
        // The reader here is the host user of this computer, so messages they wrote before they
        // signed in are their own.
        local: () => service.channels.store.list(host.channelActor().id, true),
        remote: (serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, CHANNEL_ROUTES.list, decodeChannelSummaries)
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      readChannel: scopedHandler(parseChannelRead, {
        local: (input) => service.channels.store.page(input.channelId, input.beforeSequence),
        remote: (input, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, CHANNEL_ROUTES.read, decodeChannelPage, { method: "POST", body: input })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      channelCommand: scopedHandler(parseChannelCommand, {
        local: (input) =>
          Effect.runPromise(
            service.channels.command(input, host.channelActor()).pipe(Effect.mapError((error) => error.cause)),
          ),
        remote: (input, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, CHANNEL_ROUTES.command, decodeChannel, { method: "POST", body: input })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      deleteChannel: scopedHandler(parseChannelId, {
        local: (channelId) =>
          Effect.runPromise(service.deleteChannel(channelId).pipe(Effect.mapError((error) => error.cause))),
        remote: async (channelId, serverId) => {
          if (!remoteServers.supportsCapability(serverId, CHANNEL_DELETE_CAPABILITY))
            throw new Error(sourceText("error.backend.channelDeleteUnsupported"));
          await Effect.runPromise(
            remoteServers
              .request(serverId, CHANNEL_ROUTES.delete, decodeVoid, {
                method: "POST",
                body: { channelId },
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          );
        },
      }),
      getSidebarLayout: scopedQueryHandler({
        local: () => sidebarLayout.getSnapshot(),
        remote: (serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.sidebarLayout.state, decodeSidebarLayoutSnapshot)
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      mutateSidebarLayout: scopedHandler(parseSidebarLayoutAction, {
        local: (action) =>
          Effect.runPromise(
            sidebarLayout.mutate(action, service.sidebarChatIds()).pipe(Effect.mapError((error) => error.cause)),
          ),
        remote: (action, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.sidebarLayout.actions, decodeSidebarLayoutSnapshot, {
                method: "POST",
                body: action,
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      generateProfile: scopedHandler(parseGenerateAgentProfile, {
        local: (input) =>
          Effect.runPromise(
            service
              .generateProfile(input, sidebarLayout.getSnapshot().sections)
              .pipe(Effect.mapError((error) => error.cause)),
          ),
        remote: (input, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agents.generateProfile, decodeAgentProfileDraft, {
                method: "POST",
                body: input,
                timeoutMs: 150_000,
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      saveProfile: scopedHandler(parseSaveAgentProfile, {
        local: (input) =>
          Effect.runPromise(
            service
              .saveProfile(input, sidebarLayout, host.conversationSender())
              .pipe(Effect.mapError((error) => error.cause)),
          ),
        remote: (input, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agents.saveProfile, decodeSaveAgentProfileResult, {
                method: "POST",
                body: input,
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      createAgent: scopedHandler(parseCreateAgent, {
        local: (parsed) =>
          Effect.runPromise(
            service
              .createAgent(parsed, undefined, undefined, host.conversationSender())
              .pipe(Effect.mapError((error) => error.cause)),
          ),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummary, {
                method: "POST",
                body: parsed,
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      duplicateAgent: scopedHandler(parseAgentId, {
        local: (agentId) =>
          Effect.runPromise(
            duplicateAgentIntoLayout(service, sidebarLayout, agentId).pipe(Effect.mapError((error) => error.cause)),
          ),
        remote: (agentId, serverId) =>
          Effect.runPromise(
            remoteServers
              .duplicateAgent(agentId, serverId)
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      updateAgent: scopedHandler(parseUpdateAgent, {
        local: (input) => Effect.runPromise(service.updateAgent(input).pipe(Effect.mapError((error) => error.cause))),
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
          return Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agent.one(input.agentId), decodeAgentSummary, {
                method: "PATCH",
                body: input,
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          );
        },
      }),
      setAvatar: scopedHandler(parseSetAgentAvatar, {
        local: (parsed) =>
          Effect.runPromise(
            service.setAvatar(parsed.agentId, parsed.image).pipe(Effect.mapError((error) => error.cause)),
          ),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .setAgentAvatar(parsed.agentId, parsed.image, serverId)
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      deleteAgent: scopedHandler(parseAgentId, {
        local: async (agentId) => {
          await Effect.runPromise(service.deleteAgent(agentId).pipe(Effect.mapError((error) => error.cause)));
          await Effect.runPromise(sidebarLayout.removeAgent(agentId).pipe(Effect.mapError((error) => error.cause)));
        },
        remote: async (agentId, serverId) => {
          await Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agent.one(agentId), decodeVoid, { method: "DELETE" })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          );
        },
      }),
      readConversation: scopedHandler(parseAgentId, {
        local: (agentId) =>
          Effect.runPromise(host.readAgentConversation(agentId).pipe(Effect.mapError((error) => error.cause))),
        remote: (agentId, serverId) =>
          Effect.runPromise(
            remoteServers
              .readAgentConversation(agentId, serverId)
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      readConversationPage: scopedHandler(parseReadConversationPage, {
        local: (parsed) =>
          Effect.runPromise(
            host
              .readAgentConversationPage(parsed.agentId, parsed.anchor, parsed.limit)
              .pipe(Effect.mapError((error) => error.cause)),
          ),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .readAgentConversationPage(parsed.agentId, parsed.anchor, parsed.limit, serverId)
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      searchConversationMessages: scopedHandler(parseSearchConversationMessages, {
        local: (parsed) =>
          host.searchAgentConversationMessages(parsed.query, parsed.agentId, parsed.cursor, parsed.limit),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .searchAgentConversationMessages(parsed.query, parsed.agentId, parsed.cursor, parsed.limit, serverId)
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      searchConversationFiles: payloadHandler(parseSearchConversationFiles, (parsed) =>
        host.searchAgentConversationFiles(parsed.query, parsed.cursor, parsed.limit),
      ),
      listConversationReads: scopedQueryHandler({
        local: () => host.listAgentConversationReads(),
        remote: (serverId) =>
          Effect.runPromise(
            remoteServers
              .listAgentConversationReads(serverId)
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      markConversationRead: scopedHandler(parseMarkConversationRead, {
        local: (parsed) =>
          Effect.runPromise(host.markAgentConversationRead(parsed).pipe(Effect.mapError((error) => error.cause))),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .markAgentConversationRead(parsed, serverId)
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      sendMessage: scopedHandler(parseSendMessage, {
        local: (input) =>
          Effect.runPromise(
            service.sendMessage(input, host.conversationSender()).pipe(Effect.mapError((error) => error.cause)),
          ),
        remote: (input, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agent.messages(input.agentId), decodeQueuedMessageReceipt, {
                method: "POST",
                body: input,
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      setMessageReaction: scopedHandler(parseMessageReaction, {
        local: (parsed) =>
          Effect.runPromise(service.setMessageReaction(parsed).pipe(Effect.mapError((error) => error.cause))),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agent.reactions(parsed.agentId), decodeVoid, {
                method: "POST",
                body: parsed,
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      listQueue: scopedHandler(parseAgentId, {
        local: (agentId) => service.listQueue(agentId),
        remote: (agentId, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agent.queue(agentId), decodeQueueSnapshot)
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      acknowledgeFailedTurn: scopedHandler(parseAcknowledgeFailedTurn, {
        local: (parsed) => service.acknowledgeFailedTurn(parsed.agentId, parsed.turnId),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agent.failuresAcknowledge(parsed.agentId), decodeVoid, {
                method: "POST",
                body: { turnId: parsed.turnId },
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      cancelQueuedMessage: scopedHandler(parseCancelQueuedMessage, {
        local: (parsed) =>
          Effect.runPromise(
            service
              .cancelQueuedMessage(parsed.agentId, parsed.deliveryId)
              .pipe(Effect.mapError((error) => error.cause)),
          ),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agent.queueCancel(parsed.agentId), decodeVoid, {
                method: "POST",
                body: { deliveryId: parsed.deliveryId },
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      steerQueuedMessage: scopedHandler(parseSteerQueuedMessage, {
        local: (parsed) =>
          Effect.runPromise(service.steerQueuedMessage(parsed).pipe(Effect.mapError((error) => error.cause))),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agent.queueSteer(parsed.agentId), decodeVoid, {
                method: "POST",
                body: { deliveryId: parsed.deliveryId, expectedTurnId: parsed.expectedTurnId },
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      editQueuedMessage: scopedHandler(parseQueueEdit, {
        local: ({ agentId, ...input }) =>
          Effect.runPromise(
            service
              .editQueuedMessage(agentId, input, host.conversationSender())
              .pipe(Effect.mapError((error) => error.cause)),
          ),
        remote: ({ agentId, ...input }, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agent.queueEdit(agentId), decodeQueueSnapshot, {
                method: "POST",
                body: { ...input },
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      updateQueuedMessage: scopedHandler(parseUpdateQueuedMessage, {
        local: (parsed) =>
          Effect.runPromise(
            service
              .updateQueuedMessage(parsed, host.conversationSender())
              .pipe(Effect.mapError((error) => error.cause)),
          ),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agent.queueUpdate(parsed.agentId), decodeVoid, {
                method: "POST",
                body: {
                  deliveryId: parsed.deliveryId,
                  text: parsed.text,
                  keepAttachmentIds: parsed.keepAttachmentIds,
                  attachmentDraftIds: parsed.attachmentDraftIds,
                },
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      reorderQueue: scopedHandler(parseReorderQueue, {
        local: (parsed) =>
          Effect.runPromise(service.reorderQueue(parsed).pipe(Effect.mapError((error) => error.cause))),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agent.queueReorder(parsed.agentId), decodeVoid, {
                method: "POST",
                body: { deliveryIds: parsed.deliveryIds },
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      interrupt: scopedHandler(parseInterrupt, {
        local: (parsed) =>
          Effect.runPromise(
            service.interrupt(parsed.agentId, parsed.turnId).pipe(Effect.mapError((error) => error.cause)),
          ),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agent.interrupt(parsed.agentId), decodeVoid, {
                method: "POST",
                body: { turnId: parsed.turnId },
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      clearContext: scopedHandler(parseAgentId, {
        local: (agentId) =>
          Effect.runPromise(service.clearAgentContext(agentId).pipe(Effect.mapError((error) => error.cause))),
        remote: async (agentId, serverId) => {
          if (!remoteServers.supportsCapability(serverId, CONTEXT_RESET_CAPABILITY))
            throw new Error(sourceText("error.team.contextResetUnsupported"));
          // The context-reset-v1 codec has already checked the empty reply.
          await Effect.runPromise(
            remoteServers
              .request(serverId, CONTEXT_RESET_ROUTES.clear, () => undefined, {
                method: "POST",
                body: { agentId },
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          );
        },
      }),
      respondToPrompt: scopedHandler(parsePromptResponse, {
        local: (parsed) =>
          Effect.runPromise(service.respondToPrompt(parsed).pipe(Effect.mapError((error) => error.cause))),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.respond.prompt, decodeVoid, {
                method: "POST",
                body: parsed,
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      respondToApproval: scopedHandler(parseApprovalResponse, {
        local: (parsed) =>
          Effect.runPromise(service.respondToApproval(parsed).pipe(Effect.mapError((error) => error.cause))),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.respond.approval, decodeVoid, {
                method: "POST",
                body: parsed,
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      respondToBrowserSecret: scopedHandler(parseBrowserSecretResponse, {
        local: (parsed) =>
          Effect.runPromise(service.respondToBrowserSecret(parsed).pipe(Effect.mapError((error) => error.cause))),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, BROWSER_SECRET_RESPONSE_PATH, decodeVoid, { method: "POST", body: parsed })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      respondToBrowserTakeover: scopedHandler(parseBrowserTakeoverResponse, {
        local: (parsed) =>
          Effect.runPromise(service.respondToBrowserTakeover(parsed).pipe(Effect.mapError((error) => error.cause))),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.respond.browserTakeover, decodeVoid, {
                method: "POST",
                body: parsed,
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
    },
  };
}
