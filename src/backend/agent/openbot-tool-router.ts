import { randomUUID } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentSummary,
  AvatarImageInput,
  CreateAgentInput,
  SidebarLayoutSnapshot,
  UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { isMessageReaction, skillConversationEventItemType } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { redactText } from "@openbot/logging";
import type { AgentClient } from "../agent-client";
import type { AgentTables } from "../agent-data/agent-tables";
import type { AgentStore } from "../agent-store";
import { OPENBOT_BROWSER_NAMESPACE } from "../browser-tools";
import type { ChannelService } from "../channel-service";
import type { MailboxStore } from "../mailbox-store";
import { type AppServerRequest, type DynamicToolCallParams, isRecord } from "../protocol";
import type { AgentMemories } from "./agent-memories";
import type { AttachmentGateway } from "./attachment-gateway";
import type { AttentionRegistry } from "./attention-registry";
import { loadAvatarFile } from "./avatar-file";
import type { BrowserUploads } from "./browser-uploads";
import type { ConversationRuntime } from "./conversation-runtime";
import { handleDataTool } from "./data-tools";
import { responseAttachmentMessageId } from "./delivery-content";
import type { DrainScheduler } from "./drain-scheduler";
import type { HostedSiteCoordinator } from "./hosted-site-coordinator";
import { isHostedSiteMutationTool } from "./hosted-site-events";
import type { MailboxSync } from "./mailbox-sync";
import { createAgentToolSchema, updateProfileToolSchema } from "./profile-tools";
import type { RoutineScheduler } from "./routine-scheduler";
import { type OpenBotToolResponse, openBotToolResult } from "./routine-tools";
import { type AgentSidebar, handleSidebarTool } from "./sidebar-tools";
import { LOCAL_SKILL_TOOL_DEFINITIONS, type LocalSkillTools, runLocalSkillTool } from "./skill-tools";
import { isDynamicToolCall } from "./thread-items";
import type { AgentBrowserHost } from "./turn-lifecycle";

export interface OpenBotToolRouterHooks {
  listAgents(): AgentSummary[];
  createAgent(
    input: CreateAgentInput,
    configure?: (agent: AgentSummary) => Promise<AgentSummary>,
  ): Promise<AgentSummary>;
  updateAgent(input: UpdateAgentInput): Promise<AgentSummary>;
  setAvatar(agentId: string, image: AvatarImageInput | null): Promise<AgentSummary>;
  emitError(code: string, error: unknown, agentId?: string): void;
}

export interface OpenBotToolRouterOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  mailboxSync: MailboxSync;
  conversation: ConversationRuntime;
  attention: AttentionRegistry;
  browser: AgentBrowserHost;
  browserUploads: BrowserUploads;
  attachments: AttachmentGateway;
  channels: ChannelService;
  hostedSites: HostedSiteCoordinator;
  routines: RoutineScheduler;
  memories: AgentMemories;
  drain: DrainScheduler;
  tables: AgentTables | null;
  sidebarLayout: AgentSidebar | null;
  localSkillTools?: () => LocalSkillTools;
  hooks: OpenBotToolRouterHooks;
}

/**
 * Owns the answer to every request a provider process sends to OpenBot: approvals and prompts go to
 * the attention registry, browser tools to the browser, and the `openbot` tools to the controller
 * that owns each one. The profile, reaction and `send_message` tools are answered here.
 *
 * It never imports the agent service facade.
 */
export class OpenBotToolRouter {
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #mailboxSync: MailboxSync;
  readonly #conversation: ConversationRuntime;
  readonly #attention: AttentionRegistry;
  readonly #browser: AgentBrowserHost;
  readonly #browserUploads: BrowserUploads;
  readonly #attachments: AttachmentGateway;
  readonly #channels: ChannelService;
  readonly #hostedSites: HostedSiteCoordinator;
  readonly #routines: RoutineScheduler;
  readonly #memories: AgentMemories;
  readonly #drain: DrainScheduler;
  readonly #tables: AgentTables | null;
  readonly #sidebarLayout: AgentSidebar | null;
  readonly #localSkillTools?: () => LocalSkillTools;
  readonly #hooks: OpenBotToolRouterHooks;

  constructor(options: OpenBotToolRouterOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#mailboxSync = options.mailboxSync;
    this.#conversation = options.conversation;
    this.#attention = options.attention;
    this.#browser = options.browser;
    this.#browserUploads = options.browserUploads;
    this.#attachments = options.attachments;
    this.#channels = options.channels;
    this.#hostedSites = options.hostedSites;
    this.#routines = options.routines;
    this.#memories = options.memories;
    this.#drain = options.drain;
    this.#tables = options.tables;
    this.#sidebarLayout = options.sidebarLayout;
    this.#localSkillTools = options.localSkillTools;
    this.#hooks = options.hooks;
  }

  async handle(client: AgentClient, request: AppServerRequest): Promise<void> {
    try {
      switch (request.method) {
        case "item/commandExecution/requestApproval":
          this.#attention.surfaceApproval(client, request, "command");
          return;
        case "item/fileChange/requestApproval":
          this.#attention.surfaceApproval(client, request, "file-change");
          return;
        case "item/permissions/requestApproval":
          this.#attention.surfaceApproval(client, request, "permissions");
          return;
        case "applyPatchApproval":
        case "execCommandApproval":
          this.#attention.surfaceLegacyApproval(client, request);
          return;
        case "item/tool/call": {
          if (!isDynamicToolCall(request.params)) throw new Error("Invalid dynamic tool request.");
          if (request.params.namespace === OPENBOT_BROWSER_NAMESPACE) {
            const agentId = this.#conversation.agentForThread(request.params.threadId);
            if (!agentId) throw new Error("The browsing OpenBot agent is unknown.");
            if (request.params.tool === "request_takeover" || request.params.tool === "submit_secret") {
              client.respond(request.id, await this.#attention.surfaceBrowserTakeover(request));
              return;
            }
            if (this.#attention.hasBrowserTakeoverForAgent(agentId)) {
              client.respond(request.id, {
                success: false,
                contentItems: [{ type: "inputText", text: "Browser tools are unavailable during user takeover." }],
              });
              return;
            }
            const params = {
              ...request.params,
              threadId: this.#conversation.publicThreadId(agentId, request.params.threadId),
              ownerAgentId: agentId,
            };
            client.respond(
              request.id,
              request.params.tool === "upload_files"
                ? await this.#browserUploads.uploadFiles(agentId, params)
                : await this.#browser.handleDynamicTool(params),
            );
            return;
          }
          if (request.params.namespace === "openbot") {
            if (request.params.tool === "ask_user") {
              this.#attention.surfaceDynamicPrompt(client, request);
              return;
            }
            if (isHostedSiteMutationTool(request.params.tool)) {
              await this.#attention.surfaceHostedSiteApproval(client, request, request.params, request.params.tool);
              return;
            }
            client.respond(request.id, await this.#handleOpenBotTool(request.params));
            return;
          }
          throw new Error(`Unsupported dynamic tool namespace: ${request.params.namespace}`);
        }
        case "item/tool/requestUserInput":
          this.#attention.surfacePrompt(client, request);
          return;
        case "mcpServer/elicitation/request":
          this.#attention.surfaceMcpElicitation(client, request);
          return;
        case "currentTime/read":
          client.respond(request.id, { currentTimeAt: Math.floor(Date.now() / 1_000) });
          return;
        default:
          client.respondError(request.id, {
            code: -32601,
            message: `OpenBot does not implement server request ${request.method}.`,
          });
      }
    } catch (error) {
      if (client.running) {
        try {
          client.respondError(request.id, { code: -32603, message: String(error) });
        } catch {
          // The process can exit between the running check and the write.
        }
      }
      this.#hooks.emitError("server_request_failed", error);
    }
  }

  async #handleOpenBotTool(params: DynamicToolCallParams): Promise<OpenBotToolResponse> {
    const senderAgentId = this.#conversation.agentForThread(params.threadId);
    if (!senderAgentId) throw new Error("The sending OpenBot agent is unknown.");

    if (LOCAL_SKILL_TOOL_DEFINITIONS.some((tool) => tool.name === params.tool)) {
      try {
        if (!this.#localSkillTools) throw new Error("Local skill tools are unavailable.");
        const result = openBotToolResult(
          await runLocalSkillTool(this.#localSkillTools(), senderAgentId, params.tool, params.arguments, (event) => {
            const executionThreadId = this.#conversation.publicThreadId(senderAgentId, params.threadId);
            const snapshot = structuredClone(this.#conversation.ensureSnapshot(senderAgentId, executionThreadId));
            snapshot.messages.push({
              id: randomUUID(),
              turnId: params.turnId,
              author: "system",
              source: "system",
              status: "completed",
              createdAt: new Date().toISOString(),
              itemType: skillConversationEventItemType(event),
              text: redactText(event.skillName),
            });
            const persisted = this.#store.database.persistConversation(snapshot, `skill.${event.action}`, event);
            this.#conversation.setSnapshot(senderAgentId, persisted);
            this.#conversation.publishConversation(persisted);
          }),
        );
        return {
          ...result,
          contentItems: result.contentItems.map((item) => ({ ...item, text: redactText(item.text) })),
        };
      } catch (error) {
        return {
          success: false,
          contentItems: [
            { type: "inputText", text: redactText(error instanceof Error ? error.message : String(error)) },
          ],
        };
      }
    }

    const executionThreadId = this.#conversation.publicThreadId(senderAgentId, params.threadId);
    const channelId = this.#channels.store.channelForThread(executionThreadId);
    if (channelId && (params.tool.startsWith("channel_") || params.tool === "send_message")) {
      if (params.tool === "send_message") throw new Error("Use channel_assign or channel_transfer for channel work.");
      return openBotToolResult(
        await this.#channels.tool(
          channelId,
          senderAgentId,
          params.turnId,
          params.callId,
          params.tool,
          params.arguments,
        ),
      );
    }
    if (params.tool.startsWith("channel_")) {
      return {
        success: false,
        contentItems: [
          {
            type: "inputText",
            text: "This chat has no active channel assignment. Channel tools work only inside a channel task. Use openbot.send_message for direct teammate work, or sidebar section tools (list_sections, create_section, assign_agent_section) to group agents.",
          },
        ],
      };
    }

    if (params.tool === "list_sites") {
      return openBotToolResult({ sites: await this.#hostedSites.listSites(), limit: 10 });
    }

    if (isHostedSiteMutationTool(params.tool)) throw new Error("Hosted site changes require user approval.");

    if (params.tool === "attach_files_to_response") {
      const args = params.arguments;
      if (!isRecord(args) || !Array.isArray(args.paths)) throw new Error("paths must be an array of local files.");
      if (
        args.paths.length === 0 ||
        args.paths.length > INPUT_LIMITS.attachments ||
        !args.paths.every((path) => isString(path) && path.trim().length > 0 && path.length <= INPUT_LIMITS.path)
      ) {
        throw new Error(`paths must contain between 1 and ${INPUT_LIMITS.attachments} valid local file paths.`);
      }

      const messageId = responseAttachmentMessageId(params.threadId, params.turnId, params.callId);
      return this.#attachments.attachFiles(senderAgentId, params, args.paths, messageId);
    }

    if (params.tool === "list_agents") {
      const agents = this.#hooks.listAgents().map((agent) => {
        const queue = this.#mailbox.listQueue(agent.id);
        return {
          id: agent.id,
          name: agent.name,
          title: agent.title,
          description: agent.description,
          status: this.#conversation.workingSnapshot(agent.id)?.activeTurnId
            ? "working"
            : queue.deliveries.some((delivery) => delivery.status === "queued")
              ? "queued"
              : "ready",
        };
      });
      return {
        success: true,
        contentItems: [{ type: "inputText", text: JSON.stringify({ agents }) }],
      };
    }

    if (params.tool === "create_agent") {
      const args = createAgentToolSchema.parse(params.arguments);
      const hue = args.avatarHue ?? null;
      const sectionId = this.#sidebarLayout?.getSnapshot().agentAssignments[senderAgentId] ?? null;
      const create = (assign?: (agentId: string) => Promise<SidebarLayoutSnapshot>) =>
        this.#hooks.createAgent(
          {
            name: args.name,
            description: args.description,
            initialMessage: args.initialMessage,
            avatarSeed: args.avatarSeed ?? randomUUID(),
            avatarHue: hue,
          },
          async (agent) => {
            if (assign) await assign(agent.id);
            return args.title === undefined ? agent : this.#store.updateAgent({ agentId: agent.id, title: args.title });
          },
        );
      const created =
        this.#sidebarLayout && sectionId !== null
          ? await this.#sidebarLayout.withProfileAssignment(sectionId, create)
          : await create();
      return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(created) }] };
    }

    if (params.tool === "update_profile") {
      const args = updateProfileToolSchema.parse(params.arguments);
      const { agentId, avatarHue, avatarPath, ...fields } = args;
      if (avatarPath !== undefined && (args.avatarSeed !== undefined || avatarHue !== undefined)) {
        throw new Error("Use avatarPath or generated avatar settings, not both.");
      }
      if (
        Object.values(fields).every((value) => value === undefined) &&
        avatarHue === undefined &&
        avatarPath === undefined
      ) {
        throw new Error("At least one profile field is required.");
      }
      const sender = this.#hooks.listAgents().find((agent) => agent.id === senderAgentId);
      if (!sender) throw new Error("The calling agent no longer exists.");
      const image = avatarPath === undefined ? undefined : await loadAvatarFile(avatarPath, sender.workspacePath);
      const input: UpdateAgentInput = { agentId, ...fields, ...(avatarHue === undefined ? {} : { avatarHue }) };
      let updated = await this.#hooks.updateAgent(input);
      if (image !== undefined) {
        updated = await this.#hooks.setAvatar(agentId, image);
      } else if (args.avatarSeed !== undefined || args.avatarHue !== undefined) {
        updated = await this.#hooks.setAvatar(agentId, null);
      }
      return {
        success: true,
        contentItems: [
          {
            type: "inputText",
            text: JSON.stringify({
              id: updated.id,
              name: updated.name,
              title: updated.title,
              description: updated.description,
              avatarSeed: updated.avatarSeed,
              avatarHue: updated.avatarHue,
              avatarUrl: updated.avatarUrl,
            }),
          },
        ],
      };
    }

    const sidebarResult = await handleSidebarTool(
      params.tool,
      params.arguments,
      this.#sidebarLayout,
      new Set(this.#hooks.listAgents().map((agent) => agent.id)),
    );
    if (sidebarResult) return sidebarResult;

    const routineResult = await this.#routines.handleTool(params, senderAgentId);
    if (routineResult) return routineResult;

    const memoryResult = this.#memories.handleTool(params, senderAgentId);
    if (memoryResult) return memoryResult;

    const tableResult = await handleDataTool(params.tool, params.arguments, senderAgentId, this.#tables);
    if (tableResult) return tableResult;

    if (params.tool === "react_to_user_message") {
      const args = params.arguments;
      if (!isRecord(args) || !isMessageReaction(args.emoji)) {
        throw new Error("emoji must be exactly one complete Unicode emoji.");
      }
      const delivery = this.#mailbox
        .findDeliveriesByTurn(senderAgentId, params.turnId)
        .find((candidate) => candidate.delivery.sender.kind === "user");
      if (!delivery) throw new Error("Only the current user message can receive an agent reaction.");
      await this.#mailbox.setReaction(
        senderAgentId,
        delivery.delivery.id,
        { kind: "agent", agentId: senderAgentId },
        args.emoji,
      );
      const snapshot = this.#conversation.ensureSnapshot(senderAgentId, params.threadId);
      this.#mailboxSync.syncMailboxMessages(snapshot);
      this.#conversation.emitConversation(snapshot);
      return openBotToolResult({ status: "reacted", messageId: delivery.delivery.id, emoji: args.emoji });
    }

    if (params.tool !== "send_message" || !isRecord(params.arguments)) {
      throw new Error(`Unsupported OpenBot tool: ${params.tool}`);
    }
    const recipientValues = params.arguments.recipientAgentIds;
    if (!Array.isArray(recipientValues) || !recipientValues.every((item) => isString(item))) {
      throw new Error("recipientAgentIds must be an array of agent ids.");
    }
    if (recipientValues.length !== new Set(recipientValues).size) {
      throw new Error("Duplicate recipients are not allowed.");
    }
    if (recipientValues.includes(senderAgentId)) throw new Error("An agent cannot message itself.");
    const knownIds = new Set(this.#hooks.listAgents().map((agent) => agent.id));
    for (const recipient of recipientValues) {
      if (!knownIds.has(recipient)) throw new Error(`Unknown OpenBot agent: ${recipient}`);
    }
    const paths = params.arguments.paths ?? [];
    if (!Array.isArray(paths) || !paths.every((item) => isString(item))) {
      throw new Error("paths must be an array of local file paths.");
    }
    const replyToMessageId = params.arguments.replyToMessageId;
    if (replyToMessageId !== undefined && replyToMessageId !== null && !isString(replyToMessageId)) {
      throw new Error("replyToMessageId must be a message id.");
    }
    if (!isString(params.arguments.text)) throw new Error("text is required.");
    const expectsReply = params.arguments.expectsReply;
    if (expectsReply !== undefined && typeof expectsReply !== "boolean") {
      throw new Error("expectsReply must be a boolean.");
    }

    const receipt = await this.#mailbox.enqueue({
      sender: { kind: "agent", agentId: senderAgentId },
      recipientAgentIds: recipientValues,
      text: params.arguments.text,
      sourcePaths: paths,
      replyToMessageId: replyToMessageId ?? null,
      expectsReply,
      idempotencyKey: `${params.threadId}:${params.turnId}:${params.callId}`,
    });
    for (const recipient of recipientValues) {
      this.#mailboxSync.emitQueue(recipient);
      this.#drain.scheduleDrain(recipient);
    }
    const snapshot = this.#conversation.ensureSnapshot(senderAgentId, params.threadId);
    this.#mailboxSync.syncMailboxMessages(snapshot);
    this.#conversation.emitConversation(snapshot);
    return {
      success: true,
      contentItems: [{ type: "inputText", text: JSON.stringify(receipt) }],
    };
  }
}
