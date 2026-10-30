import { randomUUID } from "node:crypto";
import { chatVisualItemType } from "@openbot/contracts/chat-visual";
import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentModelChoice,
  AgentModelOption,
  AgentSummary,
  AvatarImageInput,
  ConversationMessage,
  CreateAgentInput,
  McpServerConfig,
  SidebarLayoutSnapshot,
  UpdateAgentInput,
} from "@openbot/contracts/ipc";
import {
  agentComputerUseEnabled,
  agentNewChatAllowed,
  agentQuickAcknowledgementEnabled,
  CONNECTOR_IDS,
  isMessageReaction,
  marketplaceSuggestionItemType,
  mcpSignInItemType,
  skillConversationEventItemType,
  VAULT_CHANGE_ITEM_TYPE,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { isUiBlockId, normalizeUiBlockSpec } from "@openbot/contracts/ui-blocks";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { Effect, Result } from "effect";
import { z } from "zod";
import pluginCatalog from "../../../resources/plugin-catalog/catalog.json";
import type { AgentApiKeys, SavedApiKey } from "../agent-api-keys";
import type { AgentClient, AgentProvider } from "../agent-client";
import type { AgentTables } from "../agent-data/agent-tables";
import type { AgentStore } from "../agent-store";
import type { AgentTasks } from "../agent-tasks/agent-tasks";
import type { AgentWaits } from "../agent-waits/agent-waits";
import { OPENBOT_BROWSER_NAMESPACE } from "../browser-tools";
import type { ChannelService } from "../channel-service";
import type { ProviderSession } from "../database/provider-sessions";
import type { MailboxStore } from "../mailbox-store";
import { agentMcpServers } from "../mcp-provider-shapes";
import type { MessagingThreads } from "../messaging/messaging-threads";
import { MESSAGING_OUTBOUND_TOOLS } from "../messaging/messaging-tools";
import {
  ACKNOWLEDGE_REQUEST_ACTIONS,
  acknowledgeRequestToolSchema,
  askUiToolSchema,
  CHAT_VISUAL_PREVIEW_DEFAULT_WIDTH,
  htmlPreviewToolSchema,
  htmlRenderToolSchema,
  removeApiKeyToolSchema,
  requestApiKeyToolSchema,
  routineReportFailureToolSchema,
} from "../openbot-tools";
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
import { HistoryTools } from "./history-tools";
import type { HostedSiteCoordinator } from "./hosted-site-coordinator";
import { isHostedSiteMutationTool } from "./hosted-site-events";
import type { MailboxSync } from "./mailbox-sync";
import { type AgentMcpServers, handleMcpServerTool, isMcpServerTool, searchSignIns } from "./mcp-tools";
import {
  agentAccountSetup,
  listModelsPayload,
  modelList,
  type ProviderAccountRows,
  requestedBackupModels,
  requestedRuntime,
  requestedToolModel,
  requireReasoningEffort,
} from "./model-tools";
import {
  createAgentToolSchema,
  listModelsToolSchema,
  PROFILE_TOOL_NAMES,
  profileToolErrorMessage,
  readAgentToolSchema,
  restrictionInput,
  updateProfileToolSchema,
  widensAgentSettings,
} from "./profile-tools";
import { apiKeyFormSpec, browserUserControlResult } from "./prompts";
import { ROUTINE_NO_UPDATE_TOOL, ROUTINE_REPORT_FAILURE_TOOL } from "./routine-quiet-runs";
import type { RoutineScheduler } from "./routine-scheduler";
import { type OpenBotToolResponse, openBotToolFailure, openBotToolResult } from "./routine-tools";
import {
  captureScreenToolSchema,
  type ScreenCaptureFailed,
  type ScreenCaptureHost,
  type ScreenCaptureImage,
  type ScreenCaptureRequest,
} from "./screen-capture";
import { type AgentSidebar, handleSidebarTool } from "./sidebar-tools";
import { LOCAL_SKILL_TOOL_DEFINITIONS, type LocalSkillTools, runLocalSkillTool } from "./skill-tools";
import { isDynamicToolCall } from "./thread-items";
import { toolCallIdempotencyKey } from "./tool-call-idempotency";
import { discoverTools, namesInSearch, resolveDeferredTool } from "./tool-catalog";
import { ToolOperationFailed, toolStep, toToolOperationFailed } from "./tool-operation";
import type { AgentBrowserHost } from "./turn-lifecycle";
import { handleUpdateAgentsTool } from "./update-agents-tool";

const logger = createOpenBotLogger("openbot-tool-router");

/** How long the plan card of `acknowledge_request` waits before the host presses its start button. */
const ACKNOWLEDGE_START_MS = 10_000;

/** The tools that `#apiKeyTool` answers. */
const API_KEY_TOOLS: ReadonlySet<string> = new Set(["request_api_key", "list_api_keys", "remove_api_key"]);

/** The characters of an agent description that `list_agents` returns. `read_agent` returns all of it. */
const LISTED_DESCRIPTION_LENGTH = 300;

function listedDescription(description: string): string {
  const characters = Array.from(description);
  if (characters.length <= LISTED_DESCRIPTION_LENGTH) return description;
  return `${characters
    .slice(0, LISTED_DESCRIPTION_LENGTH - 1)
    .join("")
    .trimEnd()}…`;
}

/** The Marketplace apps that the chat draws a card for: the bundled catalog plugins and the connectors. */
const MARKETPLACE_APP_IDS: readonly string[] = [
  ...pluginCatalog.plugins.map((plugin) => plugin.slug),
  ...CONNECTOR_IDS,
];

/** The reason says what to grant or to correct, and holds no screen content. */
function captureFailure(failure: ScreenCaptureFailed) {
  return openBotToolFailure(failure.reason);
}

export interface OpenBotToolRouterHooks {
  listAgents(): AgentSummary[];
  listModels(): AgentModelOption[];
  /** The accounts of a signed-in provider, as the settings page lists them. */
  providerAccounts: ProviderAccountRows;
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
  /** Records a no-update tool call for the turn; null when no routine run started the turn. */
  requestNoUpdate(agentId: string, threadId: string, turnId: string): "quiet" | "shown" | null;
  /** Records the reason a routine run failed for the turn; false when no routine run started the turn. */
  reportRoutineFailure(agentId: string, turnId: string, reason: string): boolean;
  /** Starts a new chat with the agent when its turn ends and its queue is empty. */
  requestNewChat(agentId: string): void;
  /**
   * Takes a message from another agent into the recipient's running chat turn when the recipient's
   * busy-message mode is "steer". Otherwise the message waits in the queue.
   */
  steerAgentMessage(recipientAgentId: string, deliveryId: string): Effect.Effect<void>;
}

export interface OpenBotToolRouterOptions {
  capturedSteps?: (session: ProviderSession) => Effect.Effect<Map<string, string> | null, ToolOperationFailed>;
  store: AgentStore;
  mailbox: MailboxStore;
  mailboxSync: MailboxSync;
  conversation: ConversationRuntime;
  attention: AttentionRegistry;
  browser: AgentBrowserHost;
  browserUploads: BrowserUploads;
  attachments: AttachmentGateway;
  channels: ChannelService;
  messaging: MessagingThreads;
  hostedSites: HostedSiteCoordinator;
  routines: RoutineScheduler;
  memories: AgentMemories;
  waits: AgentWaits;
  tasks: AgentTasks;
  drain: DrainScheduler;
  tables: AgentTables | null;
  sidebarLayout: AgentSidebar | null;
  localSkillTools?: (() => LocalSkillTools) | undefined;
  routineFlowTools?: (() => RoutineFlowTools) | undefined;
  approvalAutomation?: ApprovalAutomationPolicy | undefined;
  /** Draws pages for `html_preview`; null where no window can draw one. */
  visualPreview?: ChatVisualPreviewHost | null | undefined;
  /** Captures the desktop for `capture_screen`; null where this process has no desktop. */
  screenCapture?: ScreenCaptureHost | null | undefined;
  /** The MCP servers of this OpenBot server, for the MCP tools; null where nothing holds them. */
  mcpServers?: AgentMcpServers | null | undefined;
  /** The API keys that users saved for agents; null where nothing can save them. */
  apiKeys?: AgentApiKeys | null | undefined;
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
  readonly #history: HistoryTools;
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #mailboxSync: MailboxSync;
  readonly #conversation: ConversationRuntime;
  readonly #attention: AttentionRegistry;
  readonly #browser: AgentBrowserHost;
  readonly #browserUploads: BrowserUploads;
  readonly #attachments: AttachmentGateway;
  readonly #channels: ChannelService;
  readonly #messaging: MessagingThreads;
  readonly #hostedSites: HostedSiteCoordinator;
  readonly #routines: RoutineScheduler;
  readonly #memories: AgentMemories;
  readonly #waits: AgentWaits;
  readonly #tasks: AgentTasks;
  readonly #drain: DrainScheduler;
  readonly #tables: AgentTables | null;
  readonly #sidebarLayout: AgentSidebar | null;
  readonly #localSkillTools: (() => LocalSkillTools) | undefined;
  readonly #routineFlowTools: (() => RoutineFlowTools) | undefined;
  readonly #approvalAutomation: ApprovalAutomationPolicy;
  readonly #visualPreview: ChatVisualPreviewHost | null;
  readonly #screenCapture: ScreenCaptureHost | null;
  readonly #mcpServers: AgentMcpServers | null;
  readonly #apiKeys: AgentApiKeys | null;
  readonly #hooks: OpenBotToolRouterHooks;
  readonly #interruptTool: AgentInterruptTool;

  constructor(options: OpenBotToolRouterOptions) {
    this.#history = new HistoryTools({
      store: options.store,
      redact: options.hooks.redactMcp,
      capturedSteps: options.capturedSteps ?? (() => Effect.succeed(null)),
    });
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#mailboxSync = options.mailboxSync;
    this.#conversation = options.conversation;
    this.#attention = options.attention;
    this.#browser = options.browser;
    this.#browserUploads = options.browserUploads;
    this.#attachments = options.attachments;
    this.#channels = options.channels;
    this.#messaging = options.messaging;
    this.#hostedSites = options.hostedSites;
    this.#routines = options.routines;
    this.#memories = options.memories;
    this.#waits = options.waits;
    this.#tasks = options.tasks;
    this.#drain = options.drain;
    this.#tables = options.tables;
    this.#sidebarLayout = options.sidebarLayout;
    this.#localSkillTools = options.localSkillTools;
    this.#routineFlowTools = options.routineFlowTools;
    this.#approvalAutomation = options.approvalAutomation ?? NO_APPROVAL_AUTOMATION;
    this.#visualPreview = options.visualPreview ?? null;
    this.#screenCapture = options.screenCapture ?? null;
    this.#mcpServers = options.mcpServers ?? null;
    this.#apiKeys = options.apiKeys ?? null;
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
    if (request.signal?.aborted) return;
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
          let params = request.params;
          if (params.namespace === "openbot") {
            if (params.tool === "tool_search" || params.tool === "tool_describe") {
              const agentId = this.#conversation.agentForThread(params.threadId);
              if (!agentId) throw new Error("The calling OpenBot agent is unknown.");
              let result: ReturnType<typeof discoverTools>;
              try {
                this.#requireAgent(agentId);
                result = discoverTools(params);
              } catch {
                client.respond(request.id, openBotToolFailure(sourceText("error.agent.toolRequestInvalid")));
                return;
              }
              const signIns = yield* this.#searchSignIns(agentId, params);
              if (request.signal?.aborted || !client.running) return;
              client.respond(
                request.id,
                openBotToolResult(signIns.length > 0 ? { ...result, mcpServers: signIns } : result),
              );
              return;
            }
            if (params.tool === "tool_call") {
              const resolved = resolveDeferredTool(params);
              if (!resolved) {
                client.respond(request.id, openBotToolFailure(sourceText("error.agent.toolRequestInvalid")));
                return;
              }
              params = resolved;
            }
          }
          if (params.namespace === "openbot" && (params.tool === "history_search" || params.tool === "history_read")) {
            const scope = this.#conversation.historyScope(params.threadId, client);
            if (!scope || this.#channels.store.channelForThread(scope.threadId)) {
              client.respond(request.id, openBotToolFailure(sourceText("error.agent.historyUnavailable")));
              return;
            }
            const result = yield* this.#history.call(scope.agentId, scope.threadId, params.tool, params.arguments).pipe(
              Effect.catch(() => Effect.succeed(openBotToolFailure(sourceText("error.agent.historyUnavailable")))),
              Effect.catchDefect(() =>
                Effect.succeed(openBotToolFailure(sourceText("error.agent.historyUnavailable"))),
              ),
            );
            const currentScope = this.#conversation.historyScope(params.threadId, client);
            if (!request.signal?.aborted && client.running)
              client.respond(
                request.id,
                currentScope?.threadId === scope.threadId
                  ? result
                  : openBotToolFailure(sourceText("error.agent.historyUnavailable")),
              );
            return;
          }
          // Keep the transport identifiers and abort signal; enter the original dispatch below.
          const toolRequest = { ...request, params };
          if (toolRequest.params.namespace === OPENBOT_BROWSER_NAMESPACE) {
            const agentId = this.#conversation.agentForThread(toolRequest.params.threadId);
            if (!agentId) throw new Error("The browsing OpenBot agent is unknown.");
            if (toolRequest.params.tool === "request_takeover" || toolRequest.params.tool === "submit_secret") {
              const result = yield* this.#attention.surfaceBrowserTakeover(client, toolRequest);
              // A takeover of a stopped client ends with a cancel, and that process has nothing to answer.
              if (client.running) client.respond(toolRequest.id, result);
              return;
            }
            if (this.#attention.hasBrowserTakeoverForAgent(agentId)) {
              client.respond(toolRequest.id, {
                success: false,
                contentItems: [{ type: "inputText", text: "Browser tools are unavailable during user takeover." }],
              });
              return;
            }
            const params = {
              ...toolRequest.params,
              threadId: this.#conversation.publicThreadId(agentId, toolRequest.params.threadId),
              ownerAgentId: agentId,
            };
            // While the user controls the tab, the call waits for the release and does not run.
            const userControl = (tabId: string) =>
              this.#browser.awaitUserControlRelease(tabId).pipe(Effect.as(browserUserControlResult()));
            const operation = Effect.gen({ self: this }, function* () {
              const heldTabId = this.#browser.userControlTabFor(params);
              if (heldTabId) return yield* userControl(heldTabId);
              switch (params.tool) {
                case "upload_files":
                  return yield* this.#browserUploads.uploadFiles(agentId, params);
                case "list_logins":
                  return yield* this.#attention.listVaultLogins(params);
                case "list_vault_items":
                  return yield* this.#attention.listVaultItems(params);
                case "save_vault_item":
                  return yield* this.#attention.saveVaultItem(params);
                case "delete_vault_item":
                  return yield* this.#attention.deleteVaultItem(params);
                default:
                  return yield* this.#browser.handleDynamicTool(params, {
                    onUserControl: userControl,
                    cardVault: this.#attention.cardVault(client, toolRequest, params),
                  });
              }
            });
            const signal = toolRequest.signal;
            const cancelled = Effect.callback<never>((resume) => {
              const abort = () => resume(Effect.interrupt);
              if (signal?.aborted) abort();
              else signal?.addEventListener("abort", abort, { once: true });
              return Effect.sync(() => signal?.removeEventListener("abort", abort));
            });
            if (signal?.aborted) return;
            const result = yield* operation.pipe(
              Effect.raceFirst(cancelled),
              Effect.onInterrupt(() => Effect.sync(() => this.#browser.endControl(params.threadId, params.turnId))),
            );
            if (!signal?.aborted && client.running) client.respond(toolRequest.id, result);
            return;
          }
          if (toolRequest.params.namespace === "openbot") {
            if (toolRequest.params.tool === "ask_user") {
              this.#attention.surfaceDynamicPrompt(client, toolRequest);
              return;
            }
            // Every provider gets ask_ui, Claude too: its call arrives here through the SDK MCP server.
            if (toolRequest.params.tool === "ask_ui") {
              this.#askUi(client, toolRequest, toolRequest.params);
              return;
            }
            if (toolRequest.params.tool === "acknowledge_request") {
              this.#acknowledgeRequest(client, toolRequest, toolRequest.params);
              return;
            }
            if (isHostedSiteMutationTool(toolRequest.params.tool)) {
              yield* this.#attention.surfaceHostedSiteApproval(
                client,
                toolRequest,
                toolRequest.params,
                toolRequest.params.tool,
              );
              return;
            }
            if (toolRequest.params.tool === "capture_screen" || toolRequest.params.tool === "list_capture_sources") {
              const result = yield* this.#screenCaptureTool(client, toolRequest, toolRequest.params);
              if (!toolRequest.signal?.aborted && client.running) client.respond(toolRequest.id, result);
              return;
            }
            if (API_KEY_TOOLS.has(toolRequest.params.tool)) {
              const result = yield* this.#apiKeyTool(client, toolRequest, toolRequest.params);
              if (result && !toolRequest.signal?.aborted && client.running) client.respond(toolRequest.id, result);
              return;
            }
            if (isMcpServerTool(toolRequest.params.tool)) {
              const result = yield* this.#mcpServerTool(client, toolRequest, toolRequest.params);
              if (!toolRequest.signal?.aborted && client.running) client.respond(toolRequest.id, result);
              return;
            }
            const tool = toolRequest.params.tool;
            // The calling agent can correct a profile request or an attachment path, so it gets the reason as a
            // failed tool result. Codex replaces a JSON-RPC error with "dynamic tool request failed" (#1728).
            const correctableFailure = (error: unknown) =>
              Effect.sync(() => {
                const message = this.#hooks.redactMcp(profileToolErrorMessage(error));
                if (!(error instanceof z.ZodError)) logger.warn("An OpenBot tool failed.", { tool, error: message });
                return openBotToolFailure(message);
              });
            const correctable = PROFILE_TOOL_NAMES.has(tool) || tool === "attach_files_to_response";
            const response = this.#handleOpenBotTool(toolRequest.params).pipe(
              Effect.catch((failure) => (correctable ? correctableFailure(failure.cause) : Effect.fail(failure))),
              Effect.catchDefect((defect) => (correctable ? correctableFailure(defect) : Effect.die(defect))),
              Effect.tap((result) => Effect.sync(() => client.respond(toolRequest.id, result))),
            );
            // Both store a file and then add the message that names it.
            yield* tool === "attach_files_to_response" || tool === "html_render"
              ? Effect.uninterruptible(response)
              : response;
            return;
          }
          throw new Error(`Unsupported dynamic tool namespace: ${toolRequest.params.namespace}`);
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

  /**
   * Checks an `ask_ui` call and shows its block. Like `ask_user`, it answers the call only when the
   * person answers or the turn ends. The agent can correct a refused block, so it gets the reason.
   */
  #askUi(client: AgentClient, request: AppServerRequest, params: DynamicToolCallParams): void {
    const refuse = (message: string) => client.respond(request.id, openBotToolFailure(message));
    const parsed = askUiToolSchema.safeParse(params.arguments);
    if (!parsed.success) {
      refuse(`${z.prettifyError(parsed.error)}\nCorrect the arguments and retry.`);
      return;
    }
    const spec = normalizeUiBlockSpec(parsed.data.block);
    // The stored block must read back, so its id passes the same check as the read.
    const blockId = parsed.data.blockId ?? randomUUID();
    if (!spec || !isUiBlockId(blockId)) {
      refuse(
        "The block breaks a rule: ids and option labels must be unique, an id must not be botId or a similar name, a value must be one of its options, a single choice selects at most one option, and a secret field is a text field with no value. Correct the block and retry.",
      );
      return;
    }
    this.#attention.surfaceUiBlock(client, request, { blockId, spec });
  }

  /**
   * The API key tools. `request_api_key` shows a form with one secret field, and the attention registry
   * answers it with the path of the saved key, so it returns null. The others answer at once. No result
   * holds a key value.
   */
  readonly #apiKeyTool = Effect.fn("OpenBotToolRouter.apiKeyTool")(function* (
    this: OpenBotToolRouter,
    client: AgentClient,
    request: AppServerRequest,
    params: DynamicToolCallParams,
  ) {
    const agentId = this.#conversation.agentForThread(params.threadId);
    if (!agentId) throw new Error("The calling OpenBot agent is unknown.");
    const apiKeys = this.#apiKeys;
    if (!apiKeys) return openBotToolFailure("This OpenBot server cannot save API keys.");
    const failed = (failure: { cause: unknown }) =>
      Effect.succeed(
        openBotToolFailure(
          failure.cause instanceof Error ? failure.cause.message : sourceText("error.backend.apiKeySaveFailed"),
        ),
      );
    if (params.tool === "list_api_keys")
      return yield* apiKeys.list(agentId).pipe(
        Effect.map((keys) => openBotToolResult({ keys })),
        Effect.catch(failed),
      );
    if (params.tool === "remove_api_key") {
      const parsed = removeApiKeyToolSchema.safeParse(params.arguments);
      if (!parsed.success)
        return openBotToolFailure(`${z.prettifyError(parsed.error)}\nCorrect the arguments and retry.`);
      return yield* apiKeys.remove(agentId, parsed.data.name).pipe(
        Effect.map((removed) =>
          openBotToolResult({ status: removed ? "removed" : "not_found", name: parsed.data.name }),
        ),
        Effect.catch(failed),
      );
    }
    const parsed = requestApiKeyToolSchema.safeParse(params.arguments);
    if (!parsed.success)
      return openBotToolFailure(`${z.prettifyError(parsed.error)}\nCorrect the arguments and retry.`);
    // A key that the Vault has is used as it is: a copy for this agent would not follow a change in the Vault.
    const keys = yield* apiKeys.list(agentId).pipe(Effect.catch(() => Effect.succeed<SavedApiKey[]>([])));
    const vaultKey = keys.find((key) => key.name === parsed.data.name && key.source === "vault");
    if (vaultKey) return openBotToolResult({ status: "saved", ...vaultKey });
    if (this.#messaging.store.linkForThread(this.#conversation.publicThreadId(agentId, params.threadId)))
      return openBotToolFailure(
        "request_api_key does not work in a Slack, Discord or Telegram chat. Ask the user to give you the key in OpenBot.",
      );
    const spec = apiKeyFormSpec(parsed.data);
    if (!spec) return openBotToolFailure("OpenBot could not show this form. Use a shorter title and retry.");
    this.#attention.surfaceUiBlock(client, request, {
      blockId: randomUUID(),
      spec,
      apiKey: { name: parsed.data.name },
    });
    return null;
  });

  /**
   * Shows the plan card of `acknowledge_request` and waits like `ask_ui`. When nobody answers in
   * `ACKNOWLEDGE_START_MS`, the host presses the start button, so the work never waits long for a
   * person who is away.
   */
  #acknowledgeRequest(client: AgentClient, request: AppServerRequest, params: DynamicToolCallParams): void {
    const refuse = (message: string) => client.respond(request.id, openBotToolFailure(message));
    const agentId = this.#conversation.agentForThread(params.threadId);
    const agent = agentId ? this.#store.list().find((candidate) => candidate.id === agentId) : undefined;
    if (!agent || !agentQuickAcknowledgementEnabled(agent, this.#store.agentDefaults())) {
      refuse("The user has not turned on the plan card for you. Start the work without it.");
      return;
    }
    const threadId = this.#conversation.publicThreadId(agent.id, params.threadId);
    // Nobody presses a button on Slack, Discord or Telegram.
    if (this.#messaging.store.linkForThread(threadId)) {
      refuse("This chat cannot show the plan card. Do not call it here; start the work.");
      return;
    }
    const parsed = acknowledgeRequestToolSchema.safeParse(params.arguments);
    if (!parsed.success) {
      refuse(`${z.prettifyError(parsed.error)}\nCorrect the arguments and retry.`);
      return;
    }
    const { message, steps, startLabel, cancelLabel, alternativeLabel } = parsed.data;
    const spec = normalizeUiBlockSpec({
      type: "confirm",
      title: message,
      fields: steps.map((step) => ({ label: step.label, value: step.step })),
      actions: [
        { id: ACKNOWLEDGE_REQUEST_ACTIONS.start, label: startLabel, style: "primary" },
        ...(alternativeLabel ? [{ id: ACKNOWLEDGE_REQUEST_ACTIONS.alternative, label: alternativeLabel }] : []),
        { id: ACKNOWLEDGE_REQUEST_ACTIONS.cancel, label: cancelLabel, style: "ghost" },
      ],
    });
    if (!spec) {
      refuse("Each button needs a different label. Correct the labels and retry.");
      return;
    }
    this.#attention.surfaceUiBlock(
      client,
      request,
      { blockId: randomUUID(), spec },
      { actionId: ACKNOWLEDGE_REQUEST_ACTIONS.start, afterMs: ACKNOWLEDGE_START_MS },
    );
  }

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
      ...agentAccountSetup(agent),
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
              const message: ConversationMessage = {
                id: randomUUID(),
                turnId: params.turnId,
                author: "system",
                source: "system",
                status: "completed",
                createdAt: new Date().toISOString(),
                itemType: skillConversationEventItemType(event),
                text: redactText(event.skillName),
              };
              snapshot.messages.push(message);
              snapshot.revision = this.#store.database.persistConversationChanges({
                agentId: senderAgentId,
                threadId: executionThreadId,
                activeTurnId: snapshot.activeTurnId,
                changedMessages: [message],
                eventType: `skill.${event.action}`,
                detail: event,
              });
              const persisted = snapshot;
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
    // Any agent can post on its own initiative, such as a routine that reports to a Discord channel.
    if (MESSAGING_OUTBOUND_TOOLS.has(params.tool))
      return yield* this.#messaging.outboundTool(params.tool, params.arguments);
    if (params.tool.startsWith("messaging_")) {
      // Only the agent that answers a platform conversation, in that conversation's own thread.
      const link = this.#messaging.store.linkForThread(executionThreadId);
      if (!link || link.agentId !== senderAgentId)
        return openBotToolFailure(
          "Messaging tools work only in a turn that answers a Slack, Discord or Telegram message.",
        );
      return yield* this.#messaging.tool(link, params.turnId, params.callId, params.tool, params.arguments);
    }
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
      const openWaits = this.#waits.countByAgent();
      // A hidden agent takes no new messages, so the list leaves it out.
      const agents = this.#hooks
        .listAgents()
        .filter((agent) => agent.hiddenAt === undefined)
        .map((agent) => {
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
            description: listedDescription(agent.description),
            status: working ? "working" : queuedMessages > 0 ? "queued" : "ready",
            queuedMessages,
            ...(working && startedAt !== null ? { turnStartedAt: new Date(startedAt).toISOString() } : {}),
            ...(lastActivity > 0 ? { lastActivityAt: new Date(lastActivity).toISOString() } : {}),
            ...(openWaits.has(agent.id) ? { openWaits: openWaits.get(agent.id) } : {}),
          };
        });
      return openBotToolResult({ agents });
    }

    if (params.tool === "list_models") {
      const args = listModelsToolSchema.parse(params.arguments ?? {});
      const payload = listModelsPayload(
        this.#hooks.listModels(),
        this.#hooks.preferredProvider(),
        this.#hooks.providerAccounts,
        {
          provider: args.provider,
          query: args.query,
          inUse: this.#hooks
            .listAgents()
            .flatMap((agent) => [
              { provider: agent.provider, model: agent.model },
              ...(agent.backupModels?.order ?? []),
            ]),
        },
      );
      return { success: true, contentItems: [{ type: "inputText", text: redactText(JSON.stringify(payload)) }] };
    }

    if (params.tool === "interrupt_agent") return yield* this.#interruptTool.handle(params, senderAgentId);

    if (params.tool === "read_agent") {
      const args = readAgentToolSchema.parse(params.arguments ?? {});
      const payload = yield* this.#readAgent(args.agentId ?? senderAgentId);
      return { success: true, contentItems: [{ type: "inputText", text: redactText(JSON.stringify(payload)) }] };
    }

    if (params.tool === "create_agent") return yield* this.#createAgent(params, senderAgentId);

    if (params.tool === "update_profile") return yield* this.#updateProfile(params, senderAgentId);

    if (params.tool === "update_agents") return yield* handleUpdateAgentsTool(params, senderAgentId, this.#hooks);

    if (params.tool === "start_new_chat") {
      const agent = this.#store.list().find((candidate) => candidate.id === senderAgentId);
      if (!agent || !agentNewChatAllowed(agent, this.#store.agentDefaults()))
        return openBotToolFailure(
          "The user has not allowed you to start a new chat. Ask the user to allow it in your settings, or to start a new chat there.",
        );
      if (agent.threadId !== this.#conversation.publicThreadId(senderAgentId, params.threadId))
        return openBotToolFailure("You can start a new chat only from your own chat, not from a task or a channel.");
      this.#hooks.requestNewChat(senderAgentId);
      return openBotToolResult({
        status: "requested",
        note: "The new chat starts when this turn ends and your queue is empty. A queued message that runs first ends the request. Finish your answer now.",
      });
    }

    if (params.tool === ROUTINE_NO_UPDATE_TOOL) {
      const outcome = this.#hooks.requestNoUpdate(senderAgentId, executionThreadId, params.turnId);
      if (outcome === null) return openBotToolFailure("Use this tool only in a routine run.");
      return openBotToolResult(
        outcome === "quiet"
          ? { status: "quiet", note: "This run ends without a message or a notification. End your turn now." }
          : { status: "shown", note: "Someone waits for this answer. Report the result as usual." },
      );
    }

    if (params.tool === ROUTINE_REPORT_FAILURE_TOOL) {
      const { reason } = routineReportFailureToolSchema.parse(params.arguments ?? {});
      if (!this.#hooks.reportRoutineFailure(senderAgentId, params.turnId, reason))
        return openBotToolFailure("Use this tool only in a routine run.");
      return openBotToolResult({ status: "failed", note: "This run ends as failed. Give your answer as usual." });
    }

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

    const memoryResult = this.#memories.handleTool(params, senderAgentId, this.#hooks.redactMcp);
    if (memoryResult) return memoryResult;

    const caller = {
      agentId: senderAgentId,
      inExecutionThread: this.#conversation.isExecutionThread(
        this.#conversation.publicThreadId(senderAgentId, params.threadId),
      ),
    };
    const waitResult = this.#waits.handleTool(params, caller);
    if (waitResult) return waitResult;

    const taskResult = yield* this.#tasks.handleTool(params, caller);
    if (taskResult) return taskResult;

    const tableResult = yield* handleDataTool(params.tool, params.arguments, senderAgentId, this.#tables);
    if (tableResult) return tableResult;

    if (params.tool === "suggest_marketplace_app") {
      const args = params.arguments;
      if (!isRecord(args) || !isString(args.app)) throw new Error("app must be a Marketplace app slug.");
      if (!MARKETPLACE_APP_IDS.includes(args.app)) {
        return openBotToolResult({ status: "not_found", app: args.app, apps: MARKETPLACE_APP_IDS });
      }
      this.#postSystemCard(senderAgentId, executionThreadId, params.turnId, {
        itemType: marketplaceSuggestionItemType({ appId: args.app }),
        text: sourceText("status.agent.marketplaceSuggested", { app: args.app }),
        eventType: "marketplace.suggested",
        detail: { appId: args.app },
      });
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
    yield* this.#addGeneratedMessage({
      agentId: senderAgentId,
      threadId: executionThreadId,
      turnId: params.turnId,
      messageId,
      file: {
        bytes: new TextEncoder().encode(args.html),
        name: `${visualReplyFileName(args.title)}.html`,
        mimeType: "text/html",
      },
      text: args.title,
      itemType: chatVisualItemType(args.height),
      eventType: "response.visual-added",
      detail: (attachmentId) => ({ turnId: params.turnId, messageId, attachmentId }),
    });
    return openBotToolResult({ status: "shown", messageId });
  });

  /**
   * Stores generated bytes as the attachment of one new assistant message. The file and its message
   * are saved together, so a failed save keeps no file and a retry stores one.
   */
  readonly #addGeneratedMessage = Effect.fn("OpenBotToolRouter.addGeneratedMessage")(function* (
    this: OpenBotToolRouter,
    message: {
      agentId: string;
      threadId: string;
      turnId: string;
      messageId: string;
      file: { bytes: Uint8Array; name: string; mimeType: string };
      text: string;
      itemType: string;
      eventType: string;
      detail: (attachmentId: string) => Record<string, string | number>;
    },
  ) {
    const attachment = yield* this.#mailbox
      .stageGeneratedBytes({ ...message.file, ownerAgentId: message.agentId, ownerThreadId: message.threadId })
      .pipe(toToolOperationFailed);
    // A concurrent `attach_files_to_response` keeps the live snapshot while it reads files, then saves
    // it. A replaced snapshot would make that save delete this message, so the message goes in place.
    const snapshot = this.#conversation.ensureSnapshot(message.agentId, message.threadId);
    snapshot.messages.push({
      id: message.messageId,
      turnId: message.turnId,
      author: "assistant",
      source: "assistant",
      text: message.text,
      createdAt: new Date().toISOString(),
      status: "completed",
      itemType: message.itemType,
      attachments: [attachment],
    });
    sortConversationMessages(snapshot.messages);
    try {
      const persisted = this.#mailbox.persistGeneratedAttachmentsWithConversation(
        snapshot,
        message.eventType,
        message.detail(attachment.id),
        [attachment.id],
      );
      snapshot.revision = persisted.revision;
    } catch (error) {
      const messageIndex = snapshot.messages.findIndex((candidate) => candidate.id === message.messageId);
      if (messageIndex >= 0) snapshot.messages.splice(messageIndex, 1);
      yield* this.#mailbox.discardStagedGeneratedAttachments([attachment.id]).pipe(toToolOperationFailed);
      throw error;
    }
    this.#conversation.publishConversation(snapshot);
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

  /**
   * `list_capture_sources` and `capture_screen`. The agent's Computer Use setting allows both. Each
   * capture waits for the user's approval, and the user sees the image in the conversation.
   */
  readonly #screenCaptureTool = Effect.fn("OpenBotToolRouter.screenCaptureTool")(function* (
    this: OpenBotToolRouter,
    client: AgentClient,
    request: AppServerRequest,
    params: DynamicToolCallParams,
  ) {
    const agentId = this.#conversation.agentForThread(params.threadId);
    const agent = agentId ? this.#hooks.listAgents().find((candidate) => candidate.id === agentId) : undefined;
    if (!agent) return openBotToolFailure(sourceText("error.agent.toolRequestInvalid"));
    if (!agentComputerUseEnabled(agent)) return openBotToolFailure(sourceText("error.agent.screenCaptureOff"));
    const host = this.#screenCapture;
    if (!host) return openBotToolFailure(sourceText("error.agent.screenCaptureUnavailable"));
    const threadId = this.#conversation.publicThreadId(agent.id, params.threadId);
    // A Slack, Discord or Telegram link sends each agent attachment of the turn to the platform. The
    // screen of this computer must stay on this computer.
    if (this.#messaging.store.linkForThread(threadId)) {
      return openBotToolFailure(sourceText("error.agent.screenCaptureShared"));
    }
    // A channel shows the image to each member who reads it, so each capture asks, with Full access too.
    const channelId = this.#channels.store.channelForThread(threadId);
    if (params.tool === "list_capture_sources") {
      const sources = yield* Effect.result(host.listSources());
      return Result.isFailure(sources) ? captureFailure(sources.failure) : openBotToolResult(sources.success);
    }
    const parsed = captureScreenToolSchema.safeParse(params.arguments, { reportInput: true });
    if (!parsed.success) return openBotToolFailure(profileToolErrorMessage(parsed.error));
    const capture = parsed.data;
    const messageId = responseAttachmentMessageId(params.threadId, params.turnId, params.callId);
    if (this.#conversation.ensureSnapshot(agent.id, threadId).messages.some(({ id }) => id === messageId)) {
      return openBotToolResult({ status: "shown", messageId });
    }
    const target = yield* this.#captureApprovalReason(host, capture);
    if (typeof target !== "string") return target;
    const channelName = channelId ? this.#channels.store.get(channelId).name : null;
    const reason =
      channelName === null
        ? target
        : `${target} ${sourceText("status.agent.screenCaptureChannel", { channel: channelName })}`;
    const decision = yield* this.#attention.awaitToolApproval(
      client,
      request,
      {
        requestId: request.id,
        agentId: agent.id,
        threadId,
        turnId: params.turnId,
        kind: "permissions",
        command: null,
        cwd: null,
        reason,
        grantRoot: null,
        permissions: null,
      },
      { alwaysAsk: channelId !== null },
    );
    if (decision !== "accept") return openBotToolFailure(sourceText("error.agent.screenCaptureDeclined"));
    const image = yield* Effect.result(host.capture(capture));
    if (Result.isFailure(image)) return captureFailure(image.failure);
    return yield* this.#showCapture(agent.id, threadId, params, messageId, image.success);
  });

  /**
   * The MCP tools. A change waits for the user's approval, given at once for an agent with Full
   * access, and a server that needs a sign-in gets a card in the conversation. Every failure is a
   * result the agent can correct, with the MCP secrets masked.
   */
  readonly #mcpServerTool = Effect.fn("OpenBotToolRouter.mcpServerTool")(function* (
    this: OpenBotToolRouter,
    client: AgentClient,
    request: AppServerRequest,
    params: DynamicToolCallParams,
  ) {
    const agentId = this.#conversation.agentForThread(params.threadId);
    const servers = this.#mcpServers;
    if (!agentId || !servers || !isMcpServerTool(params.tool))
      return openBotToolFailure(sourceText("error.agent.toolRequestInvalid"));
    const threadId = this.#conversation.publicThreadId(agentId, params.threadId);
    return yield* handleMcpServerTool(servers, {
      tool: params.tool,
      arguments: params.arguments,
      approve: (reason, cwd) =>
        this.#attention
          .awaitToolApproval(client, request, {
            requestId: request.id,
            agentId,
            threadId,
            turnId: params.turnId,
            kind: "permissions",
            command: null,
            cwd: cwd ?? null,
            reason,
            grantRoot: null,
            permissions: null,
          })
          .pipe(
            Effect.map((decision) => decision === "accept"),
            toToolOperationFailed,
          ),
      requestSignIn: (config) => toolStep(() => this.#postMcpSignInCard(agentId, threadId, params.turnId, config)),
    });
  });

  /**
   * The saved MCP servers that a tool search names and that need a sign-in, each with its card in the
   * conversation. A failure leaves the search as it is.
   */
  readonly #searchSignIns = Effect.fn("OpenBotToolRouter.searchSignIns")(function* (
    this: OpenBotToolRouter,
    agentId: string,
    params: DynamicToolCallParams,
  ) {
    const servers = this.#mcpServers;
    if (!servers || params.tool !== "tool_search") return [];
    const configs = servers.list();
    const names = new Set(
      namesInSearch(
        params,
        configs.map(({ name }) => name),
      ),
    );
    if (names.size === 0) return [];
    const threadId = this.#conversation.publicThreadId(agentId, params.threadId);
    return yield* searchSignIns(
      servers,
      configs.filter(({ name }) => names.has(name)),
      (config) => toolStep(() => this.#postMcpSignInCard(agentId, threadId, params.turnId, config)),
    ).pipe(
      Effect.catch((failure) => {
        logger.warn("A tool search could not test an MCP server.", {
          error: servers.redact(profileToolErrorMessage(failure.cause)),
        });
        return Effect.succeed([]);
      }),
    );
  });

  /**
   * The card that signs in to a saved http server. One for each server and turn: a search and a
   * test in the same turn, or the same search sent twice, ask for the same sign-in.
   */
  #postMcpSignInCard(agentId: string, threadId: string, turnId: string, config: McpServerConfig): void {
    const itemType = mcpSignInItemType({ mcpServerId: config.id });
    const messages = this.#conversation.ensureSnapshot(agentId, threadId).messages;
    if (messages.some((message) => message.turnId === turnId && message.itemType === itemType)) return;
    this.#postSystemCard(agentId, threadId, turnId, {
      itemType,
      text: sourceText("status.agent.mcpSignInRequested", { name: config.name }),
      eventType: "mcp.sign_in_requested",
      detail: { mcpServerId: config.id },
    });
  }

  /** Adds the note that an agent changed the Vault. `text` names the item, never a secret. */
  postVaultNote(agentId: string, threadId: string, turnId: string, text: string): void {
    this.#postSystemCard(agentId, threadId, turnId, {
      itemType: VAULT_CHANGE_ITEM_TYPE,
      text,
      eventType: "vault.changed",
      detail: {},
    });
  }

  /** Adds a card that the renderer draws from its item type, with `text` for a client that cannot. */
  #postSystemCard(
    agentId: string,
    threadId: string,
    turnId: string,
    card: {
      itemType: string;
      text: string;
      eventType: string;
      detail: { appId: string } | { mcpServerId: string } | Record<string, never>;
    },
  ): void {
    const snapshot = structuredClone(this.#conversation.ensureSnapshot(agentId, threadId));
    const message: ConversationMessage = {
      id: randomUUID(),
      turnId,
      author: "system",
      source: "system",
      status: "completed",
      createdAt: new Date().toISOString(),
      itemType: card.itemType,
      text: card.text,
    };
    snapshot.messages.push(message);
    snapshot.revision = this.#store.database.persistConversationChanges({
      agentId,
      threadId,
      activeTurnId: snapshot.activeTurnId,
      changedMessages: [message],
      eventType: card.eventType,
      detail: card.detail,
    });
    this.#conversation.setSnapshot(agentId, snapshot);
    this.#conversation.publishConversation(snapshot);
  }

  /** What the approval card says. A window that is gone is a result the agent can correct. */
  readonly #captureApprovalReason = Effect.fn("OpenBotToolRouter.captureApprovalReason")(function* (
    host: ScreenCaptureHost,
    capture: ScreenCaptureRequest,
  ) {
    if (capture.target === "region") {
      const { x, y, width, height } = capture.region;
      return sourceText("status.agent.screenCaptureRegion", { x, y, width, height });
    }
    // A failure here, such as a missing permission, is the same failure that the capture would give.
    const listed = yield* Effect.result(host.listSources());
    if (Result.isFailure(listed)) return captureFailure(listed.failure);
    const sources = listed.success;
    if (capture.target === "window") {
      const window = sources.windows.find(({ id }) => id === capture.windowId);
      if (!window) return openBotToolFailure(sourceText("error.agent.screenCaptureWindowMissing"));
      return sourceText("status.agent.screenCaptureWindow", { name: window.name });
    }
    const display = capture.displayId
      ? sources.displays.find(({ id }) => id === capture.displayId)
      : sources.displays.find(({ primary }) => primary);
    if (capture.displayId && !display) return openBotToolFailure(sourceText("error.agent.screenCaptureDisplayMissing"));
    return display?.name
      ? sourceText("status.agent.screenCaptureDisplay", { name: display.name })
      : sourceText("status.agent.screenCaptureScreen");
  });

  /**
   * Stores the capture as an attachment of a message in the conversation and gives the agent the
   * image. The image and its message are saved together, as for `html_render`.
   */
  readonly #showCapture = Effect.fn("OpenBotToolRouter.showCapture")(function* (
    this: OpenBotToolRouter,
    agentId: string,
    threadId: string,
    params: DynamicToolCallParams,
    messageId: string,
    image: ScreenCaptureImage,
  ) {
    yield* this.#addGeneratedMessage({
      agentId,
      threadId,
      turnId: params.turnId,
      messageId,
      file: {
        bytes: image.png,
        name: `Screen capture ${new Date().toISOString().replace(/[:.]/gu, "-")}.png`,
        mimeType: "image/png",
      },
      text: "",
      itemType: "agent_attachment",
      eventType: "response.attachments-added",
      detail: () => ({ turnId: params.turnId, messageId, attachmentCount: 1 }),
    });
    const result: DynamicToolResult = {
      success: true,
      contentItems: [
        {
          type: "inputText",
          text: JSON.stringify({
            status: "shown",
            messageId,
            source: image.sourceName,
            width: image.width,
            height: image.height,
          }),
        },
        { type: "inputImage", imageUrl: `data:image/png;base64,${Buffer.from(image.png).toString("base64")}` },
      ],
    };
    return result;
  }, Effect.uninterruptible);

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
      const {
        agentId,
        avatarHue,
        avatarPath,
        provider,
        model,
        reasoningEffort,
        providerAccountId,
        backupModels,
        access,
        computerUse,
        ...fields
      } = args;
      if (avatarPath !== undefined && (args.avatarSeed !== undefined || avatarHue !== undefined)) {
        throw new Error("Use avatarPath or generated avatar settings, not both.");
      }
      const runtimeRequest = { provider, model, reasoningEffort };
      if (
        Object.values(fields).every((value) => value === undefined) &&
        Object.values(runtimeRequest).every((value) => value === undefined) &&
        providerAccountId === undefined &&
        backupModels === undefined &&
        access === undefined &&
        computerUse === undefined &&
        avatarHue === undefined &&
        avatarPath === undefined
      ) {
        throw new Error("At least one profile field is required.");
      }
      const sender = this.#hooks.listAgents().find((agent) => agent.id === senderAgentId);
      if (!sender) throw new Error("The calling agent no longer exists.");
      const target = this.#requireAgent(agentId);
      if (widensAgentSettings(target, access, computerUse)) {
        return openBotToolFailure(sourceText("error.agent.onlyUserWidensSettings"));
      }
      // Checked before anything is written, so a model the provider does not list leaves the name
      // and every other field of the same call unchanged.
      const runtime = requestedRuntime(target, runtimeRequest, this.#hooks.listModels());
      // The model and account the agent has after this call. A provider change without an account
      // moves the agent to the new provider's own sign-in.
      const ownProvider = runtime.provider ?? target.provider;
      const own: AgentModelChoice = {
        provider: ownProvider,
        model: runtime.model ?? target.model,
        providerAccountId:
          providerAccountId !== undefined
            ? (providerAccountId ?? undefined)
            : ownProvider === target.provider
              ? target.providerAccountId
              : undefined,
      };
      const backups =
        backupModels === undefined
          ? undefined
          : requestedBackupModels(backupModels, this.#hooks.listModels(), this.#hooks.providerAccounts, own);
      const image =
        avatarPath === undefined
          ? undefined
          : yield* loadAvatarFile(avatarPath, sender.workspacePath).pipe(toToolOperationFailed);
      const input: UpdateAgentInput = {
        agentId,
        ...(fields.name === undefined ? {} : { name: fields.name }),
        ...(fields.title === undefined ? {} : { title: fields.title }),
        ...(fields.description === undefined ? {} : { description: fields.description }),
        ...(fields.avatarSeed === undefined ? {} : { avatarSeed: fields.avatarSeed }),
        ...(fields.notifications === undefined ? {} : { notifications: fields.notifications }),
        ...runtime,
        // The agent service checks that the account exists for the agent's provider after this change.
        ...(providerAccountId === undefined ? {} : { providerAccountId }),
        ...(backups === undefined ? {} : { backupModels: backups }),
        ...restrictionInput(access, computerUse),
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
              // A runtime change during work applies before the next turn.
              ...(updated.pendingRuntime ? { pendingRuntime: updated.pendingRuntime } : {}),
              ...agentAccountSetup(updated),
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
      // The newest one when the turn started with several of the person's messages.
      const delivery = this.#mailbox
        .findDeliveriesByTurn(senderAgentId, params.turnId)
        .findLast((candidate) => candidate.delivery.sender.kind === "user");
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
      const known = new Map(this.#hooks.listAgents().map((agent) => [agent.id, agent]));
      for (const recipient of recipientValues) {
        const agent = known.get(recipient);
        if (!agent) throw new Error(`Unknown OpenBot agent: ${recipient}`);
        // A hidden agent receives no new messages until the user restores it.
        if (agent.hiddenAt !== undefined)
          throw new Error(`${recipient}: ${sourceText("error.backend.recipientHidden")}`);
      }
      const paths = params.arguments.paths ?? [];
      if (!Array.isArray(paths) || !paths.every((item) => isString(item))) {
        throw new Error("paths must be an array of local file paths.");
      }
      const replyToMessageId = params.arguments.replyToMessageId;
      if (
        replyToMessageId !== undefined &&
        replyToMessageId !== null &&
        (!isString(replyToMessageId) || replyToMessageId.length > INPUT_LIMITS.identifier)
      ) {
        throw new Error("replyToMessageId must be a message id.");
      }
      if (!isString(params.arguments.text)) throw new Error("text is required.");
      const expectsReply = params.arguments.expectsReply;
      if (expectsReply !== undefined && typeof expectsReply !== "boolean") {
        throw new Error("expectsReply must be a boolean.");
      }

      const turnDeliveries = this.#mailbox.findDeliveriesByTurn(senderAgentId, params.turnId);
      // A request from a Slack turn: the teammate's answer goes back to that Slack thread.
      const messagingReturn = turnDeliveries
        .map(({ delivery }) => this.#mailbox.messagingOrigin(delivery.id))
        .find((origin) => origin !== null);
      // A request from a side thread: the teammate's answer goes back to that thread.
      const senderTaskId = turnDeliveries
        .map(({ delivery }) => this.#mailbox.taskIdForDelivery(delivery.id))
        .find((taskId) => taskId !== null);
      // An agent can send "" for no reply. Every reader rejects an empty id. A model can also copy the
      // quotes around the id in the delivery prompt; such an id refers to no message.
      const replyTo =
        replyToMessageId
          ?.trim()
          .replace(/^"(.*)"$/s, "$1")
          .trim() || null;
      // An answer to a request from a side thread runs in that thread. When the thread is archived, the
      // answer goes to the recipient's own chat, so it is not lost.
      const answerTaskId = replyTo ? this.#mailbox.answerTaskId(senderAgentId, replyTo, recipientValues) : null;
      const taskId = answerTaskId && this.#tasks.threadId(answerTaskId) !== null ? answerTaskId : undefined;
      const text = params.arguments.text;
      const receipt = yield* this.#mailbox
        .enqueue({
          sender: { kind: "agent", agentId: senderAgentId },
          recipientAgentIds: recipientValues,
          text,
          sourcePaths: paths,
          replyToMessageId: replyTo,
          ...(expectsReply === undefined ? {} : { expectsReply }),
          ...(messagingReturn ? { messagingReturn } : {}),
          ...(senderTaskId ? { senderTaskId } : {}),
          ...(taskId ? { taskId } : {}),
          idempotencyKey: toolCallIdempotencyKey(params),
        })
        .pipe(toToolOperationFailed);
      for (const delivery of receipt.deliveries) {
        yield* this.#hooks.steerAgentMessage(delivery.recipientAgentId, delivery.id);
        this.#mailboxSync.emitQueue(delivery.recipientAgentId);
        this.#drain.scheduleDrain(delivery.recipientAgentId);
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
