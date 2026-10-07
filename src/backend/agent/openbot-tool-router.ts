import { randomUUID } from "node:crypto";
import { chatVisualItemType } from "@openbot/contracts/chat-visual";
import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentModelOption,
  AgentSummary,
  AvatarImageInput,
  CreateAgentInput,
  McpServerConfig,
  SidebarLayoutSnapshot,
  UpdateAgentInput,
} from "@openbot/contracts/ipc";
import {
  agentComputerUseEnabled,
  isMessageReaction,
  marketplaceSuggestionItemType,
  skillConversationEventItemType,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import { isPluginSlug } from "@openbot/contracts/plugin-links";
import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { Effect, Result } from "effect";
import { z } from "zod";
import type { AgentClient, AgentProvider } from "../agent-client";
import type { AgentTables } from "../agent-data/agent-tables";
import type { AgentStore } from "../agent-store";
import { OPENBOT_BROWSER_NAMESPACE } from "../browser-tools";
import type { ChannelService } from "../channel-service";
import type { MailboxStore } from "../mailbox-store";
import { agentMcpServers } from "../mcp-provider-shapes";
import { CHAT_VISUAL_PREVIEW_DEFAULT_WIDTH, htmlPreviewToolSchema, htmlRenderToolSchema } from "../openbot-tools";
import { type AppServerRequest, type DynamicToolCallParams, type DynamicToolResult, isRecord } from "../protocol";
import { handleRoutineFlowTool, type RoutineFlowTools } from "../routine-flows/routine-flow-tools";
import type { StoredStateFailure } from "../stored-state-effects";
import { AgentInterruptTool } from "./agent-interrupt-tool";
import type { AgentMemories } from "./agent-memories";
import { type ApprovalAutomationPolicy, NO_APPROVAL_AUTOMATION } from "./approval-automation";
import type { AttachmentGateway } from "./attachment-gateway";
import type { AttentionRegistry } from "./attention-registry";
import { loadAvatarFile } from "./avatar-file";
import type { BrowserUploads } from "./browser-uploads";
import type { ChatVisualPreviewHost } from "./chat-visual-preview";
import type { ConversationRuntime } from "./conversation-runtime";
import { handleDataTool } from "./data-tools";
import { responseAttachmentMessageId, visualReplyFileName, visualReplyMessageId } from "./delivery-content";
import type { DrainScheduler } from "./drain-scheduler";
import type { HostedSiteCoordinator } from "./hosted-site-coordinator";
import { isHostedSiteMutationTool } from "./hosted-site-events";
import type { MailboxSync } from "./mailbox-sync";
import {
  listModelsPayload,
  type ModelRequest,
  modelList,
  requestedToolModel,
  requireReasoningEffort,
} from "./model-tools";
import {
  createAgentToolSchema,
  listModelsToolSchema,
  PROFILE_TOOL_NAMES,
  profileToolErrorMessage,
  readAgentToolSchema,
  updateProfileToolSchema,
} from "./profile-tools";
import type { RoutineScheduler } from "./routine-scheduler";
import { type OpenBotToolResponse, openBotToolFailure, openBotToolResult } from "./routine-tools";
import { type AgentSidebar, handleSidebarTool } from "./sidebar-tools";
import { LOCAL_SKILL_TOOL_DEFINITIONS, type LocalSkillTools, runLocalSkillTool } from "./skill-tools";
import { isDynamicToolCall } from "./thread-items";
import { ToolOperationFailed, toolStep, toToolOperationFailed } from "./tool-operation";
import type { AgentBrowserHost } from "./turn-lifecycle";

const logger = createOpenBotLogger("openbot-tool-router");

export interface OpenBotToolRouterHooks {
  listAgents(): AgentSummary[];
  listModels(): AgentModelOption[];
  preferredProvider(): AgentProvider;
  createAgent(
    input: CreateAgentInput,
    configure?: (agent: AgentSummary) => Effect.Effect<AgentSummary, ToolOperationFailed>,
  ): Effect.Effect<AgentSummary, ToolOperationFailed>;
  /** `initiatingAgentId` is the calling agent, recorded with a model change. */
  updateAgent(input: UpdateAgentInput, initiatingAgentId: string): Effect.Effect<AgentSummary, ToolOperationFailed>;
  setAvatar(agentId: string, image: AvatarImageInput | null): Effect.Effect<AgentSummary, ToolOperationFailed>;
  /** The MCP servers of this computer that are turned on, before the Computer Use setting of one agent. */
  enabledMcpServers(): McpServerConfig[];
  emitError(code: string, error: unknown, agentId?: string): void;
  /** Masks the MCP secret values and handoff values that `redactText` does not know. */
  redactMcp(text: string): string;
  /** True while the provider runs a turn for this agent, a context compaction included. */
  runsTurn(agentId: string): boolean;
  /** `false` when the turn no longer runs or `mayStop` refuses, so no stop was sent. */
  interrupt(agentId: string, turnId: string, mayStop: () => boolean): Effect.Effect<boolean, ToolOperationFailed>;
  /** Epoch milliseconds from the turn lifecycle; null when this process has not seen the event. */
  turnActivity(agentId: string, turnId: string | null): { startedAt: number | null; lastEventAt: number | null };
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
  routineFlowTools?: () => RoutineFlowTools;
  approvalAutomation?: ApprovalAutomationPolicy;
  /** Draws pages for `html_preview`; null where no window can draw one. */
  visualPreview?: ChatVisualPreviewHost | null;
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
  readonly #routineFlowTools?: () => RoutineFlowTools;
  readonly #approvalAutomation: ApprovalAutomationPolicy;
  readonly #visualPreview: ChatVisualPreviewHost | null;
  readonly #hooks: OpenBotToolRouterHooks;
  readonly #interruptTool: AgentInterruptTool;

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
    this.#routineFlowTools = options.routineFlowTools;
    this.#approvalAutomation = options.approvalAutomation ?? NO_APPROVAL_AUTOMATION;
    this.#visualPreview = options.visualPreview ?? null;
    this.#hooks = options.hooks;
    this.#interruptTool = new AgentInterruptTool({
      store: options.store,
      mailbox: options.mailbox,
      mailboxSync: options.mailboxSync,
      conversation: options.conversation,
      channels: options.channels,
      drain: options.drain,
      hooks: {
        listAgents: () => options.hooks.listAgents(),
        interrupt: (agentId, turnId, mayStop) => options.hooks.interrupt(agentId, turnId, mayStop),
      },
    });
  }

  readonly handle = Effect.fn("OpenBotToolRouter.handle")(function* (
    this: OpenBotToolRouter,
    client: AgentClient,
    request: AppServerRequest,
  ) {
    request.signal?.addEventListener("abort", () => this.#attention.cancelRequest(client, request.id), {
      once: true,
    });
    const reportFailure = (error: unknown) =>
      Effect.sync(() => {
        if (client.running) {
          try {
            client.respondError(request.id, { code: -32603, message: String(error) });
          } catch {
            // The process can exit between the running check and the write.
          }
        }
        this.#hooks.emitError("server_request_failed", error);
      });
    return yield* Effect.gen({ self: this }, function* () {
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
              const result = yield* this.#attention.surfaceBrowserTakeover(client, request);
              // A takeover of a stopped client ends with a cancel, and that process has nothing to answer.
              if (client.running) client.respond(request.id, result);
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
                ? yield* this.#browserUploads.uploadFiles(agentId, params)
                : request.params.tool === "list_logins"
                  ? yield* this.#attention.listVaultLogins(params)
                  : yield* this.#browser.handleDynamicTool(params),
            );
            return;
          }
          if (request.params.namespace === "openbot") {
            if (request.params.tool === "ask_user") {
              this.#attention.surfaceDynamicPrompt(client, request);
              return;
            }
            if (isHostedSiteMutationTool(request.params.tool)) {
              yield* this.#attention.surfaceHostedSiteApproval(client, request, request.params, request.params.tool);
              return;
            }
            const tool = request.params.tool;
            // The calling agent can correct a profile request, so it gets the reason as a failed tool result.
            const profileFailure = (error: unknown) =>
              Effect.sync(() => {
                const message = this.#hooks.redactMcp(profileToolErrorMessage(error));
                if (!(error instanceof z.ZodError)) logger.warn("A profile tool failed.", { tool, error: message });
                return openBotToolFailure(message);
              });
            const profileTool = PROFILE_TOOL_NAMES.has(tool);
            const response = this.#handleOpenBotTool(request.params).pipe(
              Effect.catch((failure) => (profileTool ? profileFailure(failure.cause) : Effect.fail(failure))),
              Effect.catchDefect((defect) => (profileTool ? profileFailure(defect) : Effect.die(defect))),
              Effect.tap((result) => Effect.sync(() => client.respond(request.id, result))),
            );
            // Both store a file and then add the message that names it.
            yield* tool === "attach_files_to_response" || tool === "html_render"
              ? Effect.uninterruptible(response)
              : response;
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
    }).pipe(
      Effect.catch((failure) => reportFailure(failure.cause)),
      Effect.catchDefect(reportFailure),
    );
  }).bind(this);

  #requireAgent(agentId: string): AgentSummary {
    const agent = this.#hooks.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(sourceText("error.agent.unknown", { id: agentId }));
    return agent;
  }

  /**
   * One agent's whole setup, for another agent to read before it changes it. MCP servers belong to
   * the user and are shown by name and transport only: their commands, environment, URLs, and
   * headers can hold secrets.
   */

  readonly #readAgent = Effect.fn("OpenBotToolRouter.readAgent")(function* (this: OpenBotToolRouter, agentId: string) {
    const agent = yield* toolStep(() => this.#requireAgent(agentId));
    const computerUse = agentComputerUseEnabled(agent);
    let skills: unknown[] | undefined;
    let skillsError: string | undefined;
    const loaded = yield* Effect.result(
      Effect.gen({ self: this }, function* () {
        const tools = yield* toolStep(() => {
          if (!this.#localSkillTools) throw new Error("Skill tools are unavailable.");
          return this.#localSkillTools();
        });
        return (yield* tools.listInstalled(agent.id).pipe(toToolOperationFailed)).map((skill) => ({
          skillId: skill.skillId,
          name: skill.name,
          ...(skill.description ? { description: skill.description } : {}),
          origin: skill.origin ?? "marketplace",
          enabled: skill.enabled !== false,
          state: skill.state,
          installedVersion: skill.installedVersion,
          ...(skill.problem ? { problem: skill.problem } : {}),
        }));
      }),
    );
    if (Result.isSuccess(loaded)) skills = loaded.success;
    else {
      const error = loaded.failure.cause;
      // The rest of the setup stays readable when the skill folders cannot be read.
      skillsError = error instanceof Error ? error.message : String(error);
    }
    return {
      id: agent.id,
      name: agent.name,
      title: agent.title,
      description: agent.description,
      provider: agent.provider,
      model: agent.model,
      reasoningEffort: agent.reasoningEffort,
      access: workspaceAccessEnforced(agent) ? "workspace" : "full",
      computerUse,
      notifications: agent.notifications,
      autoApprove: this.#approvalAutomation.autoApproves(agent.id),
      ...(skills ? { skills } : { skillsError }),
      routines: this.#routines.list(agent.id).map((routine) => ({
        id: routine.id,
        name: routine.name,
        active: routine.active,
        schedule: routine.trigger.schedule,
        nextRunAt: routine.trigger.nextRunAt,
      })),
      mcpServers: agentMcpServers(this.#hooks.enabledMcpServers(), computerUse).map((server) => ({
        name: server.name,
        transport: server.transport,
      })),
    };
  });

  /**
   * The provider, model and effort an `update_profile` call names, checked against what the CLIs list
   * now. Like `create_agent`, a model or an effort that is not listed is an error that names the valid
   * values. A new model keeps the agent's effort when it supports it, else takes the model's default.
   */
  #requestedRuntime(
    agentId: string,
    request: ModelRequest,
  ): Pick<UpdateAgentInput, "provider" | "model" | "reasoningEffort"> {
    if (request.provider === undefined && request.model === undefined && request.reasoningEffort === undefined) {
      return {};
    }
    const target = this.#requireAgent(agentId);
    const models = this.#hooks.listModels();
    const requested = requestedToolModel(request, models);
    if (requested) {
      const keptEffort = requested.supportedReasoningEfforts.includes(target.reasoningEffort)
        ? target.reasoningEffort
        : requested.defaultReasoningEffort;
      return {
        provider: requested.provider,
        model: requested.id,
        reasoningEffort: request.reasoningEffort ?? keptEffort,
      };
    }
    if (request.reasoningEffort === undefined) return {};
    const current = models.find((model) => model.provider === target.provider && model.id === target.model);
    if (!current) {
      throw new Error(
        sourceText("error.agent.modelNotListed", { model: target.model, models: modelList(models, target.provider) }),
      );
    }
    requireReasoningEffort(current, request.reasoningEffort);
    return { reasoningEffort: request.reasoningEffort };
  }

  readonly #handleOpenBotTool = Effect.fn("OpenBotToolRouter.handleOpenBotTool")(function* (
    this: OpenBotToolRouter,
    params: DynamicToolCallParams,
  ) {
    const senderAgentId = this.#conversation.agentForThread(params.threadId);
    if (!senderAgentId) throw new Error("The sending OpenBot agent is unknown.");

    if (LOCAL_SKILL_TOOL_DEFINITIONS.some((tool) => tool.name === params.tool)) {
      const reportFailure = (error: unknown) =>
        Effect.sync(() => {
          return {
            success: false,
            contentItems: [
              { type: "inputText", text: redactText(error instanceof Error ? error.message : String(error)) },
            ],
          };
        });
      return yield* Effect.gen({ self: this }, function* () {
        if (!this.#localSkillTools) throw new Error("Local skill tools are unavailable.");
        const result = openBotToolResult(
          yield* runLocalSkillTool(
            this.#localSkillTools(),
            senderAgentId,
            params.tool,
            params.arguments,
            (agentId) => this.#requireAgent(agentId ?? senderAgentId).id,
            (event) => {
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
            },
          ),
        );
        return {
          ...result,
          contentItems: result.contentItems.map((item) => ({ ...item, text: redactText(item.text) })),
        };
      }).pipe(
        Effect.catch((failure) => reportFailure(failure.cause)),
        Effect.catchDefect(reportFailure),
      );
    }

    const executionThreadId = this.#conversation.publicThreadId(senderAgentId, params.threadId);
    const channelId = this.#channels.store.channelForThread(executionThreadId);
    if (channelId && (params.tool.startsWith("channel_") || params.tool === "send_message")) {
      if (params.tool === "send_message") throw new Error("Use channel_assign or channel_transfer for channel work.");
      return openBotToolResult(
        yield* this.#channels.tool(
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

    if (params.tool === "html_preview") {
      return yield* this.#previewVisual(params);
    }

    if (params.tool === "html_render") {
      if (channelId)
        return openBotToolFailure("A channel cannot show an HTML page. Send the result as text or a file.");
      return yield* this.#renderVisual(params, senderAgentId, executionThreadId);
    }

    if (params.tool === "list_sites") {
      return openBotToolResult(yield* this.#hostedSites.listSites());
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
      return yield* this.#attachments.attachFiles(senderAgentId, params, args.paths, messageId);
    }

    if (params.tool === "list_agents") {
      // A delivery that is starting holds no turn yet, and a channel turn runs on a thread of its own.
      const unresolved = new Set(this.#mailbox.unresolvedDeliveries().map(({ delivery }) => delivery.recipientAgentId));
      const agents = this.#hooks.listAgents().map((agent) => {
        const deliveries = this.#mailbox.listQueue(agent.id).deliveries;
        const queuedMessages = deliveries.filter((delivery) => delivery.status === "queued").length;
        const working = this.#hooks.runsTurn(agent.id) || unresolved.has(agent.id);
        const activeTurnId = this.#conversation.workingSnapshot(agent.id)?.activeTurnId ?? null;
        const { startedAt, lastEventAt } = this.#hooks.turnActivity(agent.id, activeTurnId);
        // A restart loses the provider clock, so the newest message for the agent stands in for it.
        const lastActivity = deliveries.reduce(
          (latest, delivery) => Math.max(latest, Date.parse(delivery.createdAt) || 0),
          Math.max(lastEventAt ?? 0, startedAt ?? 0),
        );
        return {
          id: agent.id,
          name: agent.name,
          title: agent.title,
          description: agent.description,
          status: working ? "working" : queuedMessages > 0 ? "queued" : "ready",
          queuedMessages,
          ...(working && startedAt !== null ? { turnStartedAt: new Date(startedAt).toISOString() } : {}),
          ...(lastActivity > 0 ? { lastActivityAt: new Date(lastActivity).toISOString() } : {}),
        };
      });
      return openBotToolResult({ agents });
    }

    if (params.tool === "list_models") {
      const args = listModelsToolSchema.parse(params.arguments ?? {});
      const payload = listModelsPayload(this.#hooks.listModels(), this.#hooks.preferredProvider(), args.provider);
      return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(payload) }] };
    }

    if (params.tool === "interrupt_agent") return yield* this.#interruptTool.handle(params, senderAgentId);

    if (params.tool === "read_agent") {
      const args = readAgentToolSchema.parse(params.arguments ?? {});
      const payload = yield* this.#readAgent(args.agentId ?? senderAgentId);
      return { success: true, contentItems: [{ type: "inputText", text: redactText(JSON.stringify(payload)) }] };
    }

    if (params.tool === "create_agent") return yield* this.#createAgent(params, senderAgentId);

    if (params.tool === "update_profile") return yield* this.#updateProfile(params, senderAgentId);

    const sidebarResult = yield* handleSidebarTool(
      params.tool,
      params.arguments,
      this.#sidebarLayout,
      new Set(this.#hooks.listAgents().map((agent) => agent.id)),
    );
    if (sidebarResult) return sidebarResult;

    const routineResult = yield* this.#routines.handleTool(params, senderAgentId);
    if (routineResult) return routineResult;

    const flowResult = yield* handleRoutineFlowTool(
      params.tool,
      params.arguments,
      senderAgentId,
      this.#routineFlowTools?.() ?? null,
      new Set(this.#hooks.listAgents().map((agent) => agent.id)),
    );
    if (flowResult) return flowResult;

    const memoryResult = this.#memories.handleTool(params, senderAgentId);
    if (memoryResult) return memoryResult;

    const tableResult = yield* handleDataTool(params.tool, params.arguments, senderAgentId, this.#tables);
    if (tableResult) return tableResult;

    if (params.tool === "suggest_marketplace_app") {
      const args = params.arguments;
      if (!isRecord(args) || !isString(args.app) || !isPluginSlug(args.app)) {
        throw new Error("app must be a Marketplace plugin slug, or github.");
      }
      const snapshot = structuredClone(this.#conversation.ensureSnapshot(senderAgentId, executionThreadId));
      snapshot.messages.push({
        id: randomUUID(),
        turnId: params.turnId,
        author: "system",
        source: "system",
        status: "completed",
        createdAt: new Date().toISOString(),
        itemType: marketplaceSuggestionItemType({ appId: args.app }),
        text: sourceText("status.agent.marketplaceSuggested", { app: args.app }),
      });
      const persisted = this.#store.database.persistConversation(snapshot, "marketplace.suggested", {
        appId: args.app,
      });
      this.#conversation.setSnapshot(senderAgentId, persisted);
      this.#conversation.publishConversation(persisted);
      return openBotToolResult({ status: "suggested", app: args.app });
    }

    if (params.tool === "react_to_user_message") return yield* this.#react(params, senderAgentId);

    return yield* this.#sendMessage(params, senderAgentId);
  });

  /**
   * `html_render`: stores the page as an HTML attachment and adds a visual reply message, which the
   * app shows in a sandboxed frame above the final answer. A retried call finds its message by id.
   */
  readonly #renderVisual = Effect.fn("OpenBotToolRouter.renderVisual")(function* (
    this: OpenBotToolRouter,
    params: DynamicToolCallParams,
    senderAgentId: string,
    executionThreadId: string,
  ) {
    // The agent can correct its page, so it gets the reason. The reason does not repeat the page.
    const parsed = htmlRenderToolSchema.safeParse(params.arguments, { reportInput: true });
    if (!parsed.success) return openBotToolFailure(profileToolErrorMessage(parsed.error));
    const args = parsed.data;
    const messageId = visualReplyMessageId(params.threadId, params.turnId, params.callId);
    if (
      this.#conversation.ensureSnapshot(senderAgentId, executionThreadId).messages.some(({ id }) => id === messageId)
    ) {
      return openBotToolResult({ status: "shown", messageId });
    }
    // The page and its message are saved together, so a failed save keeps no page and a retry stores one.
    const attachment = yield* this.#mailbox
      .stageGeneratedBytes({
        bytes: new TextEncoder().encode(args.html),
        name: `${visualReplyFileName(args.title)}.html`,
        mimeType: "text/html",
        ownerAgentId: senderAgentId,
        ownerThreadId: executionThreadId,
      })
      .pipe(toToolOperationFailed);
    // A concurrent `attach_files_to_response` keeps the live snapshot while it reads files, then saves
    // it. A replaced snapshot would make that save delete this message, so the message goes in place.
    const snapshot = this.#conversation.ensureSnapshot(senderAgentId, executionThreadId);
    snapshot.messages.push({
      id: messageId,
      turnId: params.turnId,
      author: "assistant",
      source: "assistant",
      text: args.title,
      createdAt: new Date().toISOString(),
      status: "completed",
      itemType: chatVisualItemType(args.height),
      attachments: [attachment],
    });
    sortConversationMessages(snapshot.messages);
    try {
      const persisted = this.#mailbox.persistGeneratedAttachmentsWithConversation(
        snapshot,
        "response.visual-added",
        { turnId: params.turnId, messageId, attachmentId: attachment.id },
        [attachment.id],
      );
      snapshot.revision = persisted.revision;
    } catch (error) {
      const messageIndex = snapshot.messages.findIndex((candidate) => candidate.id === messageId);
      if (messageIndex >= 0) snapshot.messages.splice(messageIndex, 1);
      yield* this.#mailbox.discardStagedGeneratedAttachments([attachment.id]).pipe(toToolOperationFailed);
      throw error;
    }
    this.#conversation.publishConversation(snapshot);
    return openBotToolResult({ status: "shown", messageId });
  });

  /**
   * `html_preview`: draws the page out of view and gives the agent the image, the content height and
   * the console output. A page that fails to draw is a result the agent can correct.
   */
  readonly #previewVisual = Effect.fn("OpenBotToolRouter.previewVisual")(function* (
    this: OpenBotToolRouter,
    params: DynamicToolCallParams,
  ) {
    const parsed = htmlPreviewToolSchema.safeParse(params.arguments, { reportInput: true });
    if (!parsed.success) return openBotToolFailure(profileToolErrorMessage(parsed.error));
    const args = parsed.data;
    const preview = this.#visualPreview;
    if (!preview) return openBotToolFailure("This OpenBot cannot draw a page. Call html_render without a preview.");
    return yield* preview
      .capture({
        html: args.html,
        width: args.width ?? CHAT_VISUAL_PREVIEW_DEFAULT_WIDTH,
        appearance: args.appearance ?? "dark",
      })
      .pipe(
        Effect.map(
          ({ imageUrl, contentHeight, console }): DynamicToolResult => ({
            success: true,
            contentItems: [
              { type: "inputText", text: JSON.stringify({ contentHeight, console }) },
              { type: "inputImage", imageUrl },
            ],
          }),
        ),
        Effect.catchTag("ChatVisualPreviewFailed", (failure) => Effect.succeed(openBotToolFailure(failure.reason))),
      );
  });

  readonly #createAgent = Effect.fn("OpenBotToolRouter.createAgent")(
    function* (
      this: OpenBotToolRouter,
      params: DynamicToolCallParams,
      senderAgentId: string,
    ): Effect.fn.Return<OpenBotToolResponse, ToolOperationFailed> {
      const args = createAgentToolSchema.parse(params.arguments, { reportInput: true });
      const hue = args.avatarHue ?? null;
      const caller = this.#requireAgent(senderAgentId);
      const listed = this.#hooks.listModels();
      // Checked before the agent exists: a named model the provider does not list, or an effort the
      // model does not support, is an error the calling agent can correct, never a silent default.
      const named = requestedToolModel(args, listed);
      // A request that names no provider and no model gives the new agent the caller's own model, so
      // a team that one agent recruits runs where that agent runs. When the caller's provider no
      // longer lists that model, the new agent starts where one the user creates does.
      const inherited =
        named === null
          ? (listed.find((model) => model.provider === caller.provider && model.id === caller.model) ?? null)
          : null;
      if (inherited && args.reasoningEffort !== undefined) requireReasoningEffort(inherited, args.reasoningEffort);
      const requested = named ?? inherited;
      const reasoningEffort = args.reasoningEffort ?? (inherited ? caller.reasoningEffort : undefined);
      // An effort alone applies to the model the new agent starts on, known only once it exists.
      const lateEffort = requested === null ? args.reasoningEffort : undefined;
      const sectionId = this.#sidebarLayout?.getSnapshot().agentAssignments[senderAgentId] ?? null;
      // A new agent starts with Full access and Computer Use. A caller without them passes its limits
      // on, so it cannot get around them through an agent it creates.
      const limits: Pick<UpdateAgentInput, "access" | "computerUse"> = {
        ...(workspaceAccessEnforced(caller) ? { access: "workspace" } : {}),
        ...(agentComputerUseEnabled(caller) ? {} : { computerUse: false }),
      };
      const create = (assign?: (agentId: string) => Effect.Effect<SidebarLayoutSnapshot, StoredStateFailure>) =>
        this.#hooks.createAgent(
          {
            name: args.name,
            description: args.description,
            initialMessage: args.initialMessage,
            avatarSeed: args.avatarSeed ?? randomUUID(),
            avatarHue: hue,
            ...(requested
              ? {
                  provider: requested.provider,
                  model: requested.id,
                  ...(reasoningEffort ? { reasoningEffort } : {}),
                }
              : {}),
          },
          (agent) =>
            Effect.gen({ self: this }, function* () {
              if (assign) yield* assign(agent.id).pipe(toToolOperationFailed);
              if (lateEffort !== undefined) {
                const models = this.#hooks.listModels();
                const model = models.find(
                  (candidate) => candidate.provider === agent.provider && candidate.id === agent.model,
                );
                // The new agent can keep a stored default that its provider does not list. The error names
                // that model and the listed ones, so the caller can name a model and try again.
                if (!model) {
                  throw new Error(
                    sourceText("error.agent.modelNotListed", {
                      model: agent.model,
                      models: modelList(models, agent.provider),
                    }),
                  );
                }
                requireReasoningEffort(model, lateEffort);
              }
              if (args.title === undefined && lateEffort === undefined && Object.keys(limits).length === 0)
                return agent;
              return yield* this.#store
                .updateAgent({
                  agentId: agent.id,
                  ...(args.title === undefined ? {} : { title: args.title }),
                  ...(lateEffort === undefined ? {} : { reasoningEffort: lateEffort }),
                  ...limits,
                })
                .pipe(toToolOperationFailed);
            }).pipe(Effect.catchDefect((cause) => Effect.fail(new ToolOperationFailed({ cause })))),
        );
      const sidebar = this.#sidebarLayout;
      const created =
        sidebar && sectionId !== null
          ? yield* sidebar.withProfileAssignment(sectionId, create).pipe(toToolOperationFailed)
          : yield* create().pipe(toToolOperationFailed);
      return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(created) }] };
    },
    Effect.catchDefect((cause) => Effect.fail(new ToolOperationFailed({ cause }))),
    Effect.uninterruptible,
  );

  readonly #updateProfile = Effect.fn("OpenBotToolRouter.updateProfile")(
    function* (
      this: OpenBotToolRouter,
      params: DynamicToolCallParams,
      senderAgentId: string,
    ): Effect.fn.Return<OpenBotToolResponse, ToolOperationFailed> {
      const args = updateProfileToolSchema.parse(params.arguments, { reportInput: true });
      const { agentId, avatarHue, avatarPath, provider, model, reasoningEffort, access, computerUse, ...fields } = args;
      if (avatarPath !== undefined && (args.avatarSeed !== undefined || avatarHue !== undefined)) {
        throw new Error("Use avatarPath or generated avatar settings, not both.");
      }
      const runtimeRequest = { provider, model, reasoningEffort };
      if (
        Object.values(fields).every((value) => value === undefined) &&
        Object.values(runtimeRequest).every((value) => value === undefined) &&
        access === undefined &&
        computerUse === undefined &&
        avatarHue === undefined &&
        avatarPath === undefined
      ) {
        throw new Error("At least one profile field is required.");
      }
      const sender = this.#hooks.listAgents().find((agent) => agent.id === senderAgentId);
      if (!sender) throw new Error("The calling agent no longer exists.");
      // Only the user can widen what an agent may do. An agent can restrict itself or a teammate, and a
      // request for the value the agent already has changes nothing.
      const target = this.#requireAgent(agentId);
      if (
        (access === "full" && workspaceAccessEnforced(target)) ||
        (computerUse === true && !agentComputerUseEnabled(target))
      ) {
        return openBotToolFailure(sourceText("error.agent.onlyUserWidensSettings"));
      }
      // Checked before anything is written, so a model the provider does not list leaves the name
      // and every other field of the same call unchanged.
      const runtime = this.#requestedRuntime(agentId, runtimeRequest);
      const image =
        avatarPath === undefined
          ? undefined
          : yield* loadAvatarFile(avatarPath, sender.workspacePath).pipe(toToolOperationFailed);
      const input: UpdateAgentInput = {
        agentId,
        ...fields,
        ...runtime,
        // Only a restriction is written, so a user change between the check and this write is never undone.
        ...(access === "workspace" ? { access } : {}),
        ...(computerUse === false ? { computerUse } : {}),
        ...(avatarHue === undefined ? {} : { avatarHue }),
      };
      let updated = yield* this.#hooks.updateAgent(input, senderAgentId).pipe(toToolOperationFailed);
      if (image !== undefined) {
        updated = yield* this.#hooks.setAvatar(agentId, image).pipe(toToolOperationFailed);
      } else if (args.avatarSeed !== undefined || args.avatarHue !== undefined) {
        updated = yield* this.#hooks.setAvatar(agentId, null).pipe(toToolOperationFailed);
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
              provider: updated.provider,
              model: updated.model,
              reasoningEffort: updated.reasoningEffort,
              access: workspaceAccessEnforced(updated) ? "workspace" : "full",
              computerUse: agentComputerUseEnabled(updated),
              notifications: updated.notifications,
            }),
          },
        ],
      };
    },
    Effect.catchDefect((cause) => Effect.fail(new ToolOperationFailed({ cause }))),
    Effect.uninterruptible,
  );

  readonly #react = Effect.fn("OpenBotToolRouter.react")(
    function* (
      this: OpenBotToolRouter,
      params: DynamicToolCallParams,
      senderAgentId: string,
    ): Effect.fn.Return<OpenBotToolResponse, ToolOperationFailed> {
      const args = params.arguments;
      if (!isRecord(args) || !isMessageReaction(args.emoji)) {
        throw new Error("emoji must be exactly one complete Unicode emoji.");
      }
      const delivery = this.#mailbox
        .findDeliveriesByTurn(senderAgentId, params.turnId)
        .find((candidate) => candidate.delivery.sender.kind === "user");
      if (!delivery) throw new Error("Only the current user message can receive an agent reaction.");
      const emoji = args.emoji;
      yield* this.#mailbox
        .setReaction(senderAgentId, delivery.delivery.id, { kind: "agent", agentId: senderAgentId }, emoji)
        .pipe(toToolOperationFailed);
      const snapshot = this.#conversation.ensureSnapshot(senderAgentId, params.threadId);
      this.#mailboxSync.syncMailboxMessages(snapshot);
      this.#conversation.emitConversation(snapshot);
      return openBotToolResult({ status: "reacted", messageId: delivery.delivery.id, emoji: args.emoji });
    },
    Effect.catchDefect((cause) => Effect.fail(new ToolOperationFailed({ cause }))),
    Effect.uninterruptible,
  );

  readonly #sendMessage = Effect.fn("OpenBotToolRouter.sendMessage")(
    function* (
      this: OpenBotToolRouter,
      params: DynamicToolCallParams,
      senderAgentId: string,
    ): Effect.fn.Return<OpenBotToolResponse, ToolOperationFailed> {
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

      // A request from a Slack turn: the teammate's answer goes back to that Slack thread.
      const messagingReturn = this.#mailbox
        .findDeliveriesByTurn(senderAgentId, params.turnId)
        .map(({ delivery }) => this.#mailbox.messagingOrigin(delivery.id))
        .find((origin) => origin !== null);
      const text = params.arguments.text;
      const receipt = yield* this.#mailbox
        .enqueue({
          sender: { kind: "agent", agentId: senderAgentId },
          recipientAgentIds: recipientValues,
          text,
          sourcePaths: paths,
          replyToMessageId: replyToMessageId ?? null,
          expectsReply,
          ...(messagingReturn ? { messagingReturn } : {}),
          idempotencyKey: `${params.threadId}:${params.turnId}:${params.callId}`,
        })
        .pipe(toToolOperationFailed);
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
    },
    Effect.catchDefect((cause) => Effect.fail(new ToolOperationFailed({ cause }))),
    Effect.uninterruptible,
  );
}
