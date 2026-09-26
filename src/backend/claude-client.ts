import { execFile } from "node:child_process";
import { randomUUID, type UUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import {
  type CanUseTool,
  createSdkMcpServer,
  getSessionMessages,
  type ModelInfo,
  type Options,
  type PermissionResult,
  query,
  type SDKUserMessage,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { defaultProviderModel } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { type AgentProvider, RequestTimeoutError } from "./agent-client";
import { BROWSER_TOOL_DEFINITIONS, OPENBOT_BROWSER_NAMESPACE } from "./browser-tools";
import {
  CLAUDE_WORKSPACE_MANAGED_SETTINGS,
  claudeWorkspaceHooks,
  claudeWorkspaceSandbox,
  claudeWorkspaceSkillPlugin,
  claudeWriteOutsideRoots,
} from "./claude-workspace-sandbox";
import { type ClaudeCliInfo, claudeTakesPromptSnapshotFlag } from "./cli";
import { IdleThreadPool } from "./idle-thread-pool";
import {
  agentMcpServers,
  claudeMcpServers,
  computerUseParam,
  type McpAuthorizationSource,
  type McpDropReporter,
  type McpServerSource,
  type McpToolRuntimeSource,
  usableMcpServers,
} from "./mcp-provider-shapes";
import { OPENBOT_TOOL_DEFINITIONS } from "./openbot-tools";
import { PendingServerRequests } from "./pending-server-requests";
import {
  type AccountRateLimitsReadResult,
  type AccountRateLimitWindowResult,
  type AccountReadResult,
  type AppServerNotification,
  type AppServerRequest,
  getString,
  isRecord,
  type RequestId,
  type ResponseDecoder,
  type RpcError,
  type ThreadItem,
  type ThreadResponse,
  type TurnResponse,
} from "./protocol";

const execFileAsync = promisify(execFile);
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type ClaudeEffort = (typeof CLAUDE_EFFORTS)[number];

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string];
}

interface ThreadConfig {
  cwd: string;
  model?: string;
  effort?: string;
  developerInstructions: string;
  additionalDirectories: string[];
  persistSession: boolean;
  profileGeneration: boolean;
  /** Part of the config so that a change restarts the query with the new servers. */
  computerUse: boolean;
  /**
   * Workspace only: Bash runs in the Claude sandbox, a file write outside the roots asks the user, and
   * the project settings do not load. See `claude-workspace-sandbox.ts`.
   */
  workspaceOnly: boolean;
}

interface ActiveTurn {
  id: string;
  itemId: string;
  reasoningItemId: string;
  /** Text held back from the reader until a step boundary or the end of the turn classifies it. */
  text: string;
  /** Every assistant character this turn has produced, which is what a repeat is measured against. */
  seenText: string;
  /** What the narration already took, which the answer can no longer be rewritten over. */
  publishedText: string;
  /** The segment published last, which a message contradicting it can still put right. */
  lastNarration: { id: string; text: string } | null;
  narrationCount: number;
  thinking: string;
  thinkingStarted: boolean;
  thinkingStreamId: string | null;
  assistantMessages: Map<string, string>;
  thinkingMessages: Map<string, string>;
  toolCalls: Map<string, string>;
}

interface ThreadRuntime {
  id: string;
  usageCounterId: string;
  usageCost: number;
  config: ThreadConfig;
  appliedEffort?: string;
  input: AsyncMessageQueue;
  query: ClaudeQuery;
  activeTurn: ActiveTurn | null;
  consume: Promise<void>;
  idleRelease: ReturnType<typeof setTimeout> | null;
  idleSince: number;
}

/**
 * How long a thread with no turn keeps its `claude` process. Each process holds hundreds of MB with
 * its MCP servers, and the SDK resumes the same session from disk, so an idle thread costs only a
 * slower first message when the user comes back.
 */
export const CLAUDE_THREAD_IDLE_RELEASE_MS = 10 * 60_000;

/**
 * How many idle threads keep their `claude` process before the timeout. A user who runs one turn on
 * each of five agents otherwise holds five processes of about 140 MB each for ten minutes.
 */
export const CLAUDE_IDLE_THREAD_LIMIT = 2;

interface ClaudeStreamMessage {
  type: string;
  parent_tool_use_id?: string | null;
  event?: unknown;
  message?: unknown;
  uuid?: string;
  session_id?: string;
  subtype?: string;
  result?: string;
  errors?: string[];
  terminal_reason?: string;
  modelUsage?: unknown;
  total_cost_usd?: number;
}

interface ClaudeQuery extends AsyncIterable<ClaudeStreamMessage> {
  interrupt(): Promise<unknown>;
  supportedModels(): Promise<ModelInfo[]>;
  setModel(model?: string): Promise<void>;
  applyFlagSettings(settings: { effortLevel?: ClaudeEffort | null }): Promise<void>;
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?(): Promise<unknown>;
  close(): void;
}

type QueryFactory = (params: Parameters<typeof query>[0]) => ClaudeQuery;
type SessionHistoryReader = typeof getSessionMessages;
type ClaudeEffortCapability = { supported: ClaudeEffort[]; defaultEffort: ClaudeEffort } | null;

export class ClaudeAgentClient extends EventEmitter<ClientEvents> {
  readonly provider: AgentProvider = "claude";
  readonly #cli: ClaudeCliInfo;
  readonly #createQuery: QueryFactory;
  readonly #readSessionMessages: SessionHistoryReader;
  readonly #requestTimeoutMs: number;
  readonly #mcpServers: McpServerSource;
  readonly #reportMcpDrops: McpDropReporter | undefined;
  readonly #mcpToolRuntimes: McpToolRuntimeSource | undefined;
  readonly #mcpAuthorization: McpAuthorizationSource | undefined;
  /** Where a Workspace only query keeps its skill plugin. Without it, such a query has no workspace skills. */
  readonly #stateDirectory: string | undefined;
  /** Threads whose process was closed for being idle keep the config that resumes them. */
  readonly #threads = new IdleThreadPool<ThreadRuntime, ThreadConfig>({
    releaseAfterMs: CLAUDE_THREAD_IDLE_RELEASE_MS,
    idleLimit: CLAUDE_IDLE_THREAD_LIMIT,
    // A session that is not persisted has nothing on disk to resume from.
    canRelease: (runtime) => runtime.config.persistSession,
    snapshot: (runtime) => runtime.config,
    dispose: (runtime) => this.#closeRuntime(runtime),
    reopen: (threadId, config) => this.#startThread(threadId, config, true),
  });
  readonly #serverRequests = new PendingServerRequests((request) => this.emit("request", request));
  readonly #modelEffortCapabilities = new Map<string, ClaudeEffortCapability>();
  readonly #modelSdkValues = new Map<string, string>();
  /** Resumes of one thread run one after another: two at once would leave a query nobody closes. */
  readonly #threadResumes = new Map<string, Promise<void>>();
  #running = false;

  constructor(
    cli: ClaudeCliInfo,
    createQuery: QueryFactory = query,
    readSessionMessages: SessionHistoryReader = getSessionMessages,
    requestTimeoutMs = 30_000,
    mcpServers: McpServerSource = () => [],
    reportMcpDrops?: McpDropReporter,
    mcpToolRuntimes?: McpToolRuntimeSource,
    mcpAuthorization?: McpAuthorizationSource,
    stateDirectory?: string,
  ) {
    super();
    this.#cli = cli;
    this.#createQuery = createQuery;
    this.#readSessionMessages = readSessionMessages;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#mcpServers = mcpServers;
    this.#reportMcpDrops = reportMcpDrops;
    this.#mcpToolRuntimes = mcpToolRuntimes;
    this.#mcpAuthorization = mcpAuthorization;
    this.#stateDirectory = stateDirectory;
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    this.#running = true;
  }

  async stop(): Promise<void> {
    this.#running = false;
    const runtimes = this.#threads.clear();
    for (const runtime of runtimes) {
      runtime.input.close();
      runtime.query.close();
    }
    await Promise.allSettled(runtimes.map((runtime) => runtime.consume));
    this.#serverRequests.rejectAll("Claude session stopped.");
  }

  /**
   * Closes one thread runtime and keeps the rest of the client. The SDK query owns the MCP servers
   * of that thread, so the close is what ends those child processes. The caller releases an idle
   * thread: a turn that still runs would end with the query that carries it.
   */
  async releaseThread(threadId: string): Promise<void> {
    this.#threads.forget(threadId);
    const runtime = this.#threads.get(threadId);
    if (!runtime) return;
    await this.#threads.close(runtime);
  }

  async #closeRuntime(runtime: ThreadRuntime): Promise<void> {
    runtime.input.close();
    runtime.query.close();
    // The consumer rejects when the query ends in the middle of a turn. The runtime is already gone
    // from the map, so there is nothing left to report it against.
    await runtime.consume.catch(() => undefined);
  }

  request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number): Promise<T>;
  async request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number): Promise<T> {
    if (!this.#running) throw new Error("Claude Agent SDK is not running.");

    switch (method) {
      case "initialize":
        return decoder({});
      case "account/read":
        return decoder(await this.#readAccount());
      case "account/rateLimits/read":
        return decoder(await this.#readUsage(getString(params, "model"), timeoutMs ?? this.#requestTimeoutMs));
      case "model/list":
        return decoder({ data: await this.#listModels(timeoutMs) });
      case "plugin/list":
        return decoder({ marketplaces: [] });
      case "thread/start": {
        const threadId = randomUUID();
        await this.#startThread(threadId, readThreadConfig(params), false);
        return decoder({ thread: { id: threadId } });
      }
      case "thread/resume": {
        const threadId = requiredString(params, "threadId");
        const config = readThreadConfig(params);
        const previous = this.#threadResumes.get(threadId) ?? Promise.resolve();
        const resume = previous.catch(() => undefined).then(() => this.#resumeThread(threadId, config));
        this.#threadResumes.set(threadId, resume);
        try {
          await resume;
        } finally {
          if (this.#threadResumes.get(threadId) === resume) this.#threadResumes.delete(threadId);
        }
        return decoder({ thread: { id: threadId } });
      }
      case "thread/read":
        return decoder(await this.#readThread(requiredString(params, "threadId")));
      case "turn/start":
        return decoder(await this.#startTurn(params));
      case "turn/steer":
        return decoder(await this.#steerTurn(params));
      case "turn/interrupt": {
        const threadId = requiredString(params, "threadId");
        // A released thread has no turn to stop.
        if (this.#threads.isReleased(threadId)) return decoder({});
        const runtime = this.#requireThread(threadId);
        await runtime.query.interrupt();
        return decoder({});
      }
      case "thread/compact/start":
        // Claude Code manages its own context compaction.
        return decoder({});
      default:
        throw new Error(`Claude adapter does not implement ${method}.`);
    }
  }

  notify(): void {
    // Claude Agent SDK has no initialize notification.
  }

  respond(id: RequestId, result: unknown): void {
    this.#serverRequests.resolve(id, result);
  }

  respondError(id: RequestId, error: RpcError): void {
    this.#serverRequests.reject(id, error);
  }

  /**
   * A model list or a usage read runs no tools, so it starts none of the user's MCP servers. Each
   * server is a process of its own (`npx chrome-devtools-mcp` is about 480 MB), and these reads run
   * at every start and on every usage refresh.
   */
  #probeOptions(): Options {
    return {
      cwd: process.cwd(),
      pathToClaudeCodeExecutable: this.#cli.executable,
      settingSources: ["user", "project", "local"],
      mcpServers: {},
      strictMcpConfig: true,
      persistSession: false,
      env: { ...claudeEnvironment(this.#cli), CLAUDE_AGENT_SDK_CLIENT_APP: "openbot/0.1.0" },
    };
  }

  async #listModels(timeoutMs?: number): Promise<unknown[]> {
    const input = new AsyncMessageQueue();
    const claudeQuery = this.#createQuery({
      prompt: input,
      options: this.#probeOptions(),
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const discovery = claudeQuery.supportedModels();
      const discovered =
        timeoutMs === undefined
          ? await discovery
          : await Promise.race([
              discovery,
              new Promise<ModelInfo[]>((_, reject) => {
                timeout = setTimeout(() => {
                  input.close();
                  claudeQuery.close();
                  reject(new RequestTimeoutError("Claude", "model/list"));
                }, timeoutMs);
              }),
            ]);
      const models = new Map<string, (typeof discovered)[number]>();
      for (const model of discovered) {
        const id = model.resolvedModel?.trim() || model.value.trim();
        if (!id || models.has(id)) continue;
        models.set(id, model);
      }
      const effortCapabilities = new Map<string, ClaudeEffortCapability>();
      const sdkValues = new Map<string, string>();
      const result = [...models.entries()].map(([id, model]) => {
        const discoveredReasoningEfforts = [
          ...new Set((model.supportedEffortLevels ?? []).filter((effort) => isOneOf(CLAUDE_EFFORTS, effort))),
        ];
        const supportedReasoningEfforts =
          discoveredReasoningEfforts.length > 0 ? discoveredReasoningEfforts : ["medium" as const];
        const defaultReasoningEffort = supportedReasoningEfforts.includes("high")
          ? "high"
          : (supportedReasoningEfforts[0] ?? "medium");
        effortCapabilities.set(
          id,
          model.supportsEffort === false
            ? null
            : { supported: supportedReasoningEfforts, defaultEffort: defaultReasoningEffort },
        );
        sdkValues.set(id, model.value.trim() || id);
        return {
          model: id,
          displayName: model.displayName,
          defaultReasoningEffort,
          supportedReasoningEfforts: supportedReasoningEfforts.map((reasoningEffort) => ({ reasoningEffort })),
        };
      });
      this.#modelEffortCapabilities.clear();
      this.#modelSdkValues.clear();
      for (const [id, capability] of effortCapabilities) this.#modelEffortCapabilities.set(id, capability);
      for (const [id, value] of sdkValues) this.#modelSdkValues.set(id, value);
      return result;
    } finally {
      if (timeout) clearTimeout(timeout);
      input.close();
      claudeQuery.close();
    }
  }

  async #readUsage(model: string | null, timeoutMs: number): Promise<AccountRateLimitsReadResult> {
    const input = new AsyncMessageQueue();
    const claudeQuery = this.#createQuery({
      prompt: input,
      options: this.#probeOptions(),
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const readUsage = claudeQuery.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
      if (!readUsage) return { rateLimits: null, rateLimitsByLimitId: null };
      const usage = await Promise.race([
        readUsage.call(claudeQuery),
        new Promise<unknown>((_, reject) => {
          timeout = setTimeout(() => {
            input.close();
            claudeQuery.close();
            reject(new RequestTimeoutError("Claude", "account/rateLimits/read"));
          }, timeoutMs);
        }),
      ]);
      return claudeRateLimits(usage, model);
    } finally {
      if (timeout) clearTimeout(timeout);
      input.close();
      claudeQuery.close();
    }
  }

  async #readAccount(): Promise<AccountReadResult> {
    const status = await this.#readAuthStatus();
    if (status.loggedIn !== true) return { account: null, requiresOpenaiAuth: false };
    return {
      account: {
        type: "claude",
        email: isString(status.email) ? status.email : null,
        planType: isString(status.subscriptionType) ? status.subscriptionType : null,
      },
      requiresOpenaiAuth: false,
    };
  }

  /**
   * `claude auth status` exits 1 when signed out and still prints its status. Only a status says
   * signed out: a timeout, a failed spawn or unreadable output throws, so an account refresh keeps
   * the working client instead of stopping it as signed out.
   */
  async #readAuthStatus(): Promise<DynamicRecord> {
    let stdout: unknown;
    let failure: unknown = null;
    try {
      ({ stdout } = await execFileAsync(this.#cli.executable, ["auth", "status", "--json"], {
        timeout: 5_000,
        maxBuffer: 64 * 1024,
        shell: process.platform === "win32",
        env: claudeEnvironment(this.#cli),
      }));
    } catch (error) {
      failure = error;
      stdout = isRecord(error) ? error.stdout : undefined;
    }
    const status = parseAuthStatus(stdout);
    if (status && (failure === null || status.loggedIn === false)) return status;
    throw failure ?? new Error("Claude returned an unreadable sign-in status.");
  }

  async #resumeThread(threadId: string, config: ThreadConfig): Promise<void> {
    // A turn can open a released thread again at each await here: that query is the one to
    // compare, not a second one, so the check runs again until this resume opens the thread.
    for (;;) {
      await this.#threads.opened(threadId);
      const current = this.#threads.get(threadId);
      if (current && JSON.stringify(current.config) === JSON.stringify(config)) return;
      if (current) {
        if (current.activeTurn) throw new Error(sourceText("error.provider.claudeTurnActive"));
        await this.#threads.close(current);
        continue;
      }
      if (await this.#threads.opening(threadId, () => this.#startThread(threadId, config, true))) return;
    }
  }

  async #startThread(threadId: string, config: ThreadConfig, resume: boolean): Promise<void> {
    const input = new AsyncMessageQueue();
    const appliedEffort = this.#resolveEffort(config.model, config.effort);
    const canUseTool: CanUseTool = async (toolName, toolInput, options) => {
      if (config.profileGeneration) return { behavior: "deny", message: "Profile generation has no tools." };
      if (config.workspaceOnly) {
        const outside = await claudeWriteOutsideRoots(toolName, toolInput, config.cwd, config.additionalDirectories);
        if (outside) return this.#requestWriteApproval(threadId, outside, toolInput, options.toolUseID ?? randomUUID());
      }
      if (toolName !== "AskUserQuestion") {
        return { behavior: "allow", updatedInput: toolInput } satisfies PermissionResult;
      }
      return this.#requestUserInput(threadId, toolInput, options.toolUseID ?? randomUUID());
    };
    // OpenBot's own servers spread last: Claude keys this record by name, so a user configuration
    // that reached one of those names would take the agent's own tools away. Profile generation
    // asks one question and must not act, so it gets neither set.
    const handoff = config.profileGeneration
      ? null
      : claudeMcpServers(
          await usableMcpServers(
            agentMcpServers(this.#mcpServers(), config.computerUse),
            this.#mcpToolRuntimes?.(),
            this.#mcpAuthorization,
          ),
        );
    const skillPlugin =
      config.workspaceOnly && this.#stateDirectory
        ? await claudeWorkspaceSkillPlugin(this.#stateDirectory, config.cwd)
        : null;
    // `stop()` may have run during the await: a query created now would outlive the client.
    if (!this.#running) throw new Error("Claude Agent SDK is not running.");
    if (handoff) this.#reportMcpDrops?.(this.provider, handoff.dropped);
    const mcpServers = handoff ? { ...handoff.servers, ...this.#createOpenBotServers(threadId) } : {};
    const claudeQuery = this.#createQuery({
      prompt: input,
      options: {
        cwd: config.cwd,
        pathToClaudeCodeExecutable: this.#cli.executable,
        ...(config.model ? { model: this.#sdkModel(config.model) } : {}),
        ...(appliedEffort ? { effort: appliedEffort } : {}),
        ...(resume ? { resume: threadId } : { sessionId: threadId }),
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: config.developerInstructions,
        },
        // The developer instructions carry the profile and the memories, and `thread/resume` above
        // restarts the query when they change. A recorded prompt would be sent instead of them on
        // every later request and resume, so the agent kept an edited profile's old text. The CLI
        // flag, not the SDK's `systemPromptSnapshot` option: the CLI records by default and ignores
        // that option.
        ...(claudeTakesPromptSnapshotFlag(this.#cli.version) ? { extraArgs: { "system-prompt-snapshot": "off" } } : {}),
        ...(config.profileGeneration ? { tools: [] } : {}),
        settingSources: config.profileGeneration ? [] : config.workspaceOnly ? ["user"] : ["user", "project", "local"],
        // The MCP panel is the only door. Without this, Claude merges project `.mcp.json`, user
        // settings, plugin and agent-frontmatter servers into the record above, so two computers
        // with the same OpenBot settings give their agents different tools and "which servers does
        // my agent have" has no answer. The flag takes away MCP and nothing else, so permissions and
        // hooks still load from those files. Workspace only loads the user settings alone: see
        // `claude-workspace-sandbox.ts`.
        strictMcpConfig: true,
        permissionMode: "default",
        includePartialMessages: true,
        persistSession: config.persistSession,
        additionalDirectories: config.additionalDirectories,
        canUseTool,
        ...(config.workspaceOnly
          ? {
              sandbox: claudeWorkspaceSandbox(config.additionalDirectories),
              hooks: claudeWorkspaceHooks(config.cwd, config.additionalDirectories),
              managedSettings: CLAUDE_WORKSPACE_MANAGED_SETTINGS,
              plugins: skillPlugin ? [skillPlugin] : [],
            }
          : {}),
        mcpServers,
        env: { ...claudeEnvironment(this.#cli), CLAUDE_AGENT_SDK_CLIENT_APP: "openbot/0.1.0" },
      },
    });
    const runtime: ThreadRuntime = {
      id: threadId,
      usageCounterId: randomUUID(),
      usageCost: 0,
      config,
      appliedEffort,
      input,
      query: claudeQuery,
      activeTurn: null,
      consume: Promise.resolve(),
      idleRelease: null,
      idleSince: 0,
    };
    runtime.consume = this.#consume(runtime);
    this.#threads.add(runtime);
  }

  async #startTurn(params: unknown): Promise<TurnResponse> {
    const threadId = requiredString(params, "threadId");
    return this.#threads.startTurn(threadId, () => this.#openTurn(threadId, params));
  }

  async #openTurn(threadId: string, params: unknown): Promise<TurnResponse> {
    await this.#threads.wake(threadId);
    const runtime = this.#requireThread(threadId);
    if (runtime.activeTurn) throw new Error("The Claude thread already has an active turn.");

    const requestedModel = getString(params, "model");
    const modelChanged = Boolean(requestedModel && requestedModel !== runtime.config.model);
    if (requestedModel && modelChanged) {
      await runtime.query.setModel(this.#sdkModel(requestedModel));
      runtime.config.model = requestedModel;
    }
    const requestedEffort = getString(params, "effort");
    const selectedEffort = requestedEffort ?? runtime.config.effort;
    const appliedEffort = this.#resolveEffort(runtime.config.model, selectedEffort);
    if (!appliedEffort) {
      if (runtime.appliedEffort !== undefined) await runtime.query.applyFlagSettings({ effortLevel: null });
      runtime.appliedEffort = undefined;
    } else if (modelChanged || appliedEffort !== runtime.appliedEffort) {
      await runtime.query.applyFlagSettings({ effortLevel: appliedEffort });
      runtime.appliedEffort = appliedEffort;
    }
    if (requestedEffort) runtime.config.effort = requestedEffort;

    const clientId = getString(params, "clientUserMessageId");
    const turnId = clientId && isUuid(clientId) ? clientId : randomUUID();
    const text = readInputText(params);
    const activeTurn = {
      id: turnId,
      itemId: `${turnId}:assistant`,
      reasoningItemId: `${turnId}:reasoning`,
      text: "",
      seenText: "",
      publishedText: "",
      lastNarration: null,
      narrationCount: 0,
      thinking: "",
      thinkingStarted: false,
      thinkingStreamId: null,
      assistantMessages: new Map<string, string>(),
      thinkingMessages: new Map<string, string>(),
      toolCalls: new Map<string, string>(),
    };
    runtime.activeTurn = activeTurn;
    // Only now: a model or effort change that fails above leaves the idle timer armed, so the
    // pool can still release the thread.
    this.#threads.holdForTurn(runtime);
    this.emit("notification", {
      method: "turn/started",
      params: { threadId, turn: { id: turnId, status: "inProgress" } },
    });
    runtime.input.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      uuid: turnId,
      session_id: threadId,
    });
    return { turn: { id: turnId, status: "inProgress" } };
  }

  async #steerTurn(params: unknown): Promise<{ turnId: string }> {
    const threadId = requiredString(params, "threadId");
    const runtime = this.#requireThread(threadId);
    const expectedTurnId = requiredString(params, "expectedTurnId");
    if (!runtime.activeTurn || runtime.activeTurn.id !== expectedTurnId) {
      throw new Error("The active Claude turn changed before steering was accepted.");
    }
    const clientId = getString(params, "clientUserMessageId");
    const messageId = clientId && isUuid(clientId) ? clientId : randomUUID();
    runtime.input.push({
      type: "user",
      message: { role: "user", content: readInputText(params) },
      parent_tool_use_id: null,
      uuid: messageId,
      session_id: threadId,
    });
    return { turnId: runtime.activeTurn.id };
  }

  async #consume(runtime: ThreadRuntime): Promise<void> {
    try {
      for await (const message of runtime.query) this.#handleMessage(runtime, message);
      if (this.#running && this.#threads.get(runtime.id) === runtime) {
        this.#fail(new Error("Claude session stream ended unexpectedly."));
      }
    } catch (error) {
      if (!this.#running || this.#threads.get(runtime.id) !== runtime) return;
      const activeTurn = runtime.activeTurn;
      if (activeTurn) this.#completeTurn(runtime, "failed", error);
      this.#fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  #fail(error: Error): void {
    if (!this.#running) return;
    this.#running = false;
    this.emit("exit", error);
  }

  #handleMessage(runtime: ThreadRuntime, message: ClaudeStreamMessage): void {
    if (message.type === "stream_event" && message.parent_tool_use_id === null) {
      const event = message.event;
      const delta = isRecord(event) ? event.delta : null;
      if (event && isRecord(event) && event.type === "content_block_delta" && isRecord(delta)) {
        if (delta.type === "text_delta" && isString(delta.text)) this.#bufferText(runtime, delta.text);
        else if (delta.type === "thinking_delta" && isString(delta.thinking)) {
          this.#appendThinkingDelta(runtime, delta.thinking, message.uuid);
        }
      }
      return;
    }

    if (message.type === "assistant") {
      if (message.parent_tool_use_id !== null) return;
      const turn = runtime.activeTurn;
      const text = messageText(message.message);
      if (!turn || !message.uuid) return;
      const thinking = messageThinking(message.message);
      /* The deltas never announced this block, so its own order is all there is to say what came
         before it. Text the message placed there is narration, and only that much may go. */
      if (thinking && message.uuid !== turn.thinkingStreamId) {
        const before = textBeforeThinking(message.message);
        if (before) {
          turn.assistantMessages.set(message.uuid, before);
          const upToBoundary = [...turn.assistantMessages.values()].join("");
          this.#reconcileText(runtime, upToBoundary);
          this.#flushNarration(runtime);
        }
      }
      if (thinking) {
        turn.thinkingMessages.set(message.uuid, thinking);
        const completeThinking = [...turn.thinkingMessages.values()].join("\n");
        if (completeThinking.startsWith(turn.thinking)) {
          this.#appendThinkingDelta(runtime, completeThinking.slice(turn.thinking.length));
        }
      }
      /* Hold this message's own text first. Claude can omit the stream deltas and send one message
         carrying the narration together with the call it introduces, and a flush that ran before
         the text was held would see an empty buffer and leave that narration for the answer. */
      if (text) {
        turn.assistantMessages.set(message.uuid, text);
        this.#reconcileText(runtime, [...turn.assistantMessages.values()].join(""));
      }
      const toolCalls = messageToolCalls(message.message);
      // A tool call closes the step, which makes the text before it narration rather than an answer.
      if (toolCalls.length > 0) this.#flushNarration(runtime);
      for (const toolCall of toolCalls) {
        if (turn.toolCalls.has(toolCall.id)) continue;
        turn.toolCalls.set(toolCall.id, toolCall.name);
        this.#emitToolCall(runtime, toolCall.id, toolCall.name, false);
      }
      return;
    }

    if (message.type === "user") {
      const turn = runtime.activeTurn;
      if (!turn) return;
      for (const toolCallId of messageToolResults(message.message)) {
        const name = turn.toolCalls.get(toolCallId);
        if (!name) continue;
        turn.toolCalls.delete(toolCallId);
        this.#emitToolCall(runtime, toolCallId, name, true);
      }
      return;
    }

    if (message.type !== "result") return;
    if (
      message.subtype === "success" &&
      message.total_cost_usd !== undefined &&
      message.total_cost_usd < runtime.usageCost
    )
      runtime.usageCounterId = randomUUID();
    if (message.subtype === "success" || (message.total_cost_usd ?? 0) > runtime.usageCost)
      runtime.usageCost = message.total_cost_usd ?? runtime.usageCost;
    if (runtime.activeTurn && message.modelUsage)
      this.emit("notification", {
        method: "openbot/usage",
        params: {
          threadId: runtime.id,
          turnId: runtime.activeTurn.id,
          counterId: runtime.usageCounterId,
          modelUsage: message.modelUsage,
        },
      });
    const fallback = message.subtype === "success" ? message.result : "";
    const errors = message.errors ?? [];
    const turn = runtime.activeTurn;
    if (turn) {
      for (const [toolCallId, name] of turn.toolCalls) {
        this.#emitToolCall(runtime, toolCallId, name, true);
      }
      turn.toolCalls.clear();
      this.#reconcileText(runtime, [...turn.assistantMessages.values()].join(""));
      if (!turn.seenText && fallback) this.#bufferText(runtime, fallback);
    }
    const interrupted =
      message.terminal_reason === "aborted_streaming" ||
      message.terminal_reason === "aborted_tools" ||
      errors.some((error) => /interrupt|abort/i.test(error));
    const status = interrupted ? "interrupted" : message.subtype === "success" ? "completed" : "failed";
    this.#completeTurn(runtime, status, errors.length > 0 ? errors.join("\n") : null);
  }

  #emitToolCall(runtime: ThreadRuntime, id: string, name: string, completed: boolean): void {
    const turn = runtime.activeTurn;
    if (!turn) return;
    this.emit("notification", {
      method: completed ? "item/completed" : "item/started",
      params: {
        threadId: runtime.id,
        turnId: turn.id,
        item: { id, type: "toolCall", name, status: completed ? "completed" : "in_progress" },
      },
    });
  }

  /* Claude streams reasoning as its own content block; the app-server vocabulary carries it as a
     separate agentMessage item whose `commentary` phase becomes the thinking disclosure. */
  #appendThinkingDelta(runtime: ThreadRuntime, delta: string, streamId?: string): void {
    const turn = runtime.activeTurn;
    if (!turn || !delta) return;
    /* A thinking block beginning closes the step. Filling in the rest of one that already began
       does not, and a message carries that backfill with no stream of its own: flushing there
       would publish text the turn holds for its answer as narration and end with no answer. */
    if (streamId !== undefined && streamId !== turn.thinkingStreamId) this.#flushNarration(runtime);
    if (!turn.thinkingStarted) {
      turn.thinkingStarted = true;
      this.emit("notification", {
        method: "item/started",
        params: {
          threadId: runtime.id,
          turnId: turn.id,
          item: { id: turn.reasoningItemId, type: "agentMessage", phase: "commentary" },
        },
      });
    }
    const nextDelta = streamId && turn.thinkingStreamId && streamId !== turn.thinkingStreamId ? `\n${delta}` : delta;
    if (streamId) turn.thinkingStreamId = streamId;
    turn.thinking += nextDelta;
    this.emit("notification", {
      method: "item/agentMessage/delta",
      params: {
        threadId: runtime.id,
        turnId: turn.id,
        itemId: turn.reasoningItemId,
        delta: nextDelta,
      },
    });
  }

  /* Claude cannot say which text is its answer while the text arrives: the narration before a tool
     call reads the same as the reply that ends the turn. Hold it here instead of streaming it into
     the answer item, where every word of it drew a chat bubble that the end of the turn rewrote. */
  #bufferText(runtime: ThreadRuntime, delta: string): void {
    const turn = runtime.activeTurn;
    if (!turn || !delta) return;
    turn.text += delta;
    turn.seenText += delta;
  }

  /**
   * Let the complete assistant messages correct what the stream delivered.
   *
   * A delta can go missing, and the complete messages are the ones Claude stands behind. They can
   * only rewrite what no step boundary has published yet, so this has to run before every flush
   * while the current step can still be corrected: publishing a stale step would strand every
   * later comparison behind text Claude never sent, and the answer would be dropped with it.
   */
  #reconcileText(runtime: ThreadRuntime, completeText: string): void {
    const turn = runtime.activeTurn;
    if (!turn) return;
    if (completeText.startsWith(turn.seenText)) {
      this.#bufferText(runtime, completeText.slice(turn.seenText.length));
      return;
    }
    if (completeText.length === 0) return;
    if (completeText.startsWith(turn.publishedText)) {
      turn.text = completeText.slice(turn.publishedText.length);
      turn.seenText = completeText;
      return;
    }
    this.#correctNarration(runtime, completeText);
  }

  /**
   * Put right the narration a boundary published before any message stood behind it.
   *
   * Thinking closes a step while the message carrying the text is still arriving, so the only text
   * there is to publish is what the deltas gave. When the message then disagrees, the published
   * segment is republished under its own ID rather than left to strand every later comparison
   * behind words Claude never sent. Text already held for the answer is not taken into it.
   */
  #correctNarration(runtime: ThreadRuntime, completeText: string): void {
    const turn = runtime.activeTurn;
    const last = turn?.lastNarration;
    if (!turn || !last) return;
    const prefix = turn.publishedText.slice(0, turn.publishedText.length - last.text.length);
    if (!completeText.startsWith(prefix)) return;
    const heldBack = turn.text.length > 0 && completeText.endsWith(turn.text) ? turn.text.length : 0;
    const corrected = completeText.slice(prefix.length, completeText.length - heldBack);
    if (!corrected || corrected === last.text) return;
    last.text = corrected;
    turn.publishedText = `${prefix}${corrected}`;
    // Whatever the correction did not take is the answer's again, so the two stay in step.
    turn.text = completeText.slice(prefix.length + corrected.length);
    turn.seenText = completeText;
    this.emit("notification", {
      method: "item/completed",
      params: {
        threadId: runtime.id,
        turnId: turn.id,
        item: { id: last.id, type: "agentMessage", phase: "commentary", text: corrected },
      },
    });
  }

  /** Publish held text as the thinking disclosure, which is what a step boundary proves it was. */
  #flushNarration(runtime: ThreadRuntime): void {
    const turn = runtime.activeTurn;
    if (!turn?.text) return;
    const text = turn.text;
    const id = `${turn.id}:narration:${turn.narrationCount}`;
    this.emit("notification", {
      method: "item/completed",
      params: {
        threadId: runtime.id,
        turnId: turn.id,
        item: { id, type: "agentMessage", phase: "commentary", text },
      },
    });
    turn.lastNarration = { id, text };
    turn.narrationCount += 1;
    turn.publishedText += text;
    turn.text = turn.text.slice(text.length);
  }

  #completeTurn(runtime: ThreadRuntime, status: string, error: unknown): void {
    const turn = runtime.activeTurn;
    if (!turn) return;
    if (turn.thinkingStarted) {
      this.emit("notification", {
        method: "item/completed",
        params: {
          threadId: runtime.id,
          turnId: turn.id,
          item: { id: turn.reasoningItemId, type: "agentMessage", phase: "commentary", text: turn.thinking },
        },
      });
    }
    this.emit("notification", {
      method: "item/completed",
      params: {
        threadId: runtime.id,
        turnId: turn.id,
        item: { id: turn.itemId, type: "agentMessage", text: turn.text },
      },
    });
    if (status === "failed" && error) {
      this.emit("notification", {
        method: "error",
        params: { threadId: runtime.id, turnId: turn.id, message: String(error) },
      });
    }
    this.emit("notification", {
      method: "turn/completed",
      params: { threadId: runtime.id, turn: { id: turn.id, status } },
    });
    runtime.activeTurn = null;
    this.#threads.markIdle(runtime);
  }

  async #readThread(threadId: string): Promise<ThreadResponse> {
    const cwd = this.#threads.get(threadId)?.config.cwd ?? this.#threads.released(threadId)?.cwd;
    const messages = await this.#readSessionMessages(threadId, cwd ? { dir: cwd } : undefined);
    const turns: NonNullable<ThreadResponse["thread"]["turns"]> = [];
    let current: (typeof turns)[number] | null = null;
    let currentThinking: ThreadItem | null = null;
    /* Only a turn's last answer is an answer. Every earlier one was narration between tool calls,
       so it is demoted as soon as the next one proves it was not the end of the turn. A restored
       thread otherwise reopens with the chat bubbles a live turn no longer draws. */
    let currentAnswer: ThreadItem | null = null;
    for (const message of messages) {
      if (message.parent_tool_use_id) continue;
      const text = messageText(message.message);
      if (message.type === "user") {
        if (!text) continue;
        current = {
          id: message.uuid,
          status: "completed",
          items: [
            {
              id: message.uuid,
              type: "userMessage",
              clientId: message.uuid,
              content: [{ type: "text", text }],
            },
          ],
        };
        turns.push(current);
        currentThinking = null;
        currentAnswer = null;
      } else if (message.type === "assistant") {
        const thinking = messageThinking(message.message);
        const endsStep = messageToolCalls(message.message).length > 0;
        if (!thinking && !text && !endsStep) continue;
        if (!current && (thinking || text)) {
          current = { id: message.uuid, status: "completed", items: [] };
          turns.push(current);
          currentThinking = null;
          currentAnswer = null;
        }
        if (!current) continue;
        /* One message can hold text on both sides of its thinking, and only what follows can be
           the answer. The live turn splits it there, so restoring has to split it the same way. */
        const beforeThinking = thinking ? textBeforeThinking(message.message) : "";
        if (thinking) {
          /* Thinking closes the step for a live turn, so it has to close it here as well. A turn
             that stopped while thinking otherwise keeps the text that led to it as the answer. */
          if (currentAnswer) {
            currentAnswer.phase = "commentary";
            currentAnswer = null;
          }
          if (beforeThinking) {
            current.items?.push({
              id: `${message.uuid}:narration`,
              type: "agentMessage",
              phase: "commentary",
              text: beforeThinking,
            });
          }
          if (currentThinking) {
            currentThinking.text = `${currentThinking.text ?? ""}\n${thinking}`;
          } else {
            currentThinking = {
              id: `${current.id}:reasoning`,
              type: "agentMessage",
              phase: "commentary",
              text: thinking,
            };
            current.items?.push(currentThinking);
          }
        }
        const answerText = text.slice(beforeThinking.length);
        if (answerText) {
          if (currentAnswer) currentAnswer.phase = "commentary";
          currentAnswer = { id: message.uuid, type: "agentMessage", text: answerText };
          current.items?.push(currentAnswer);
        }
        /* A tool call closes the step here too, including one the same message introduced. Without
           this, a turn that stopped on its tool call keeps the narration that led to it as the
           answer, and restores the bubble the live path removed. */
        if (endsStep && currentAnswer) {
          currentAnswer.phase = "commentary";
          currentAnswer = null;
        }
      }
    }
    return { thread: { id: threadId, turns } };
  }

  #createOpenBotServers(threadId: string) {
    const call = (namespace: string, name: string, args: unknown) =>
      this.#callDynamicTool(threadId, namespace, name, args);
    return {
      openbot_browser: createSdkMcpServer({
        name: OPENBOT_BROWSER_NAMESPACE,
        version: "0.2.0",
        tools: BROWSER_TOOL_DEFINITIONS.map((definition) =>
          tool(definition.name, definition.description, definition.shape, (args) =>
            call(OPENBOT_BROWSER_NAMESPACE, definition.name, args),
          ),
        ),
      }),
      openbot: createSdkMcpServer({
        name: "openbot",
        version: "0.1.0",
        // Claude uses the SDK's AskUserQuestion permission flow.
        tools: OPENBOT_TOOL_DEFINITIONS.filter((definition) => definition.name !== "ask_user").map((definition) =>
          tool(definition.name, definition.description, definition.shape, (args) =>
            call("openbot", definition.name, args),
          ),
        ),
      }),
    };
  }

  async #callDynamicTool(threadId: string, namespace: string, name: string, args: unknown): Promise<CallToolResult> {
    const runtime = this.#requireThread(threadId);
    const result = await this.#serverRequests.call("item/tool/call", {
      threadId,
      turnId: runtime.activeTurn?.id ?? randomUUID(),
      callId: randomUUID(),
      namespace,
      tool: name,
      arguments: args,
    });
    if (!isRecord(result)) return { content: [{ type: "text" as const, text: String(result) }] };
    const content: CallToolResult["content"] = [];
    if (Array.isArray(result.contentItems)) {
      for (const item of result.contentItems) content.push(...dynamicContent(item));
    }
    return { content, isError: result.success === false };
  }

  async #requestUserInput(threadId: string, input: DynamicRecord, toolUseId: string): Promise<PermissionResult> {
    const runtime = this.#requireThread(threadId);
    const rawQuestions = Array.isArray(input.questions) ? input.questions.filter(isRecord) : [];
    const questions = rawQuestions.map((question, index) => ({
      id: `question-${index}`,
      header: isString(question.header) ? question.header : "Question",
      question: isString(question.question) ? question.question : "Claude needs more information.",
      options: Array.isArray(question.options) ? question.options : undefined,
    }));
    const result = await this.#serverRequests.call("item/tool/requestUserInput", {
      threadId,
      turnId: runtime.activeTurn?.id ?? randomUUID(),
      itemId: toolUseId,
      questions,
    });
    const responseAnswers = isRecord(result) && isRecord(result.answers) ? result.answers : {};
    const answers = Object.fromEntries(
      questions.map((question) => {
        const entry = responseAnswers[question.id];
        const values = isRecord(entry) && Array.isArray(entry.answers) ? entry.answers : [];
        return [question.question, values.filter((value): value is string => isString(value)).join(", ")];
      }),
    );
    return { behavior: "allow", updatedInput: { questions: input.questions, answers } };
  }

  /**
   * A Workspace only agent's file write outside its roots, shown as a file-change approval. The
   * approval registry never answers it without the user, as for a Codex write outside the sandbox.
   */
  async #requestWriteApproval(
    threadId: string,
    path: string,
    toolInput: DynamicRecord,
    toolUseId: string,
  ): Promise<PermissionResult> {
    const result = await this.#serverRequests.call("item/fileChange/requestApproval", {
      threadId,
      turnId: this.#threads.get(threadId)?.activeTurn?.id ?? randomUUID(),
      itemId: toolUseId,
      reason: sourceText("status.agent.claudeWriteOutside", { path }),
    });
    if (isRecord(result) && result.decision === "accept") return { behavior: "allow", updatedInput: toolInput };
    return { behavior: "deny", message: "The user did not allow this write outside the workspace." };
  }

  #requireThread(threadId: string): ThreadRuntime {
    const runtime = this.#threads.get(threadId);
    if (!runtime) throw new Error(`Unknown Claude thread: ${threadId}`);
    return runtime;
  }

  #resolveEffort(model: string | undefined, effort: string | undefined): ClaudeEffort | undefined {
    if (!effort) return undefined;
    const normalized = normalizeClaudeEffort(effort);
    if (!model) return normalized;
    const capability = this.#modelEffortCapabilities.get(model);
    if (capability === null) return undefined;
    if (!capability || capability.supported.includes(normalized)) return normalized;
    return capability.defaultEffort;
  }

  #sdkModel(model: string): string {
    return this.#modelSdkValues.get(model) ?? normalizeClaudeModel(model);
  }
}

function claudeEnvironment(cli: ClaudeCliInfo): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(cli.source === "managed" ? { DISABLE_AUTOUPDATER: "1" } : {}),
  };
}

function claudeRateLimits(value: unknown, model: string | null): AccountRateLimitsReadResult {
  if (!isDynamicRecord(value) || value.rate_limits_available !== true || !isDynamicRecord(value.rate_limits)) {
    return { rateLimits: null, rateLimitsByLimitId: null };
  }
  const rateLimits = value.rate_limits;
  const primary = claudeUsageWindow(rateLimits.five_hour, 300);
  const secondary = claudeModelWeeklyWindow(rateLimits, model) ?? claudeUsageWindow(rateLimits.seven_day, 10_080);
  if (!primary && !secondary) return { rateLimits: null, rateLimitsByLimitId: null };
  return {
    rateLimits: { limitId: "claude", primary, secondary },
    rateLimitsByLimitId: null,
  };
}

function claudeModelWeeklyWindow(rateLimits: DynamicRecord, model: string | null): AccountRateLimitWindowResult | null {
  if (!model) return null;
  const familyKey = model.toLowerCase().includes("opus")
    ? "seven_day_opus"
    : model.toLowerCase().includes("sonnet")
      ? "seven_day_sonnet"
      : null;
  if (familyKey) {
    const family = claudeUsageWindow(rateLimits[familyKey], 10_080);
    if (family) return family;
  }
  return null;
}

function claudeUsageWindow(value: unknown, windowDurationMins: number): AccountRateLimitWindowResult | null {
  if (!isDynamicRecord(value)) return null;
  const usedPercent = numberValue(value.utilization) ?? numberValue(value.percent);
  if (usedPercent === null) return null;
  const reset = stringValue(value.resets_at) ?? stringValue(value.resetsAt);
  const resetMilliseconds = reset ? Date.parse(reset) : Number.NaN;
  return {
    usedPercent,
    windowDurationMins,
    resetsAt: Number.isFinite(resetMilliseconds) ? resetMilliseconds / 1_000 : null,
  };
}

function stringValue(value: unknown): string | null {
  return isString(value) && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return isNumber(value) && Number.isFinite(value) ? value : null;
}

class AsyncMessageQueue implements AsyncIterable<SDKUserMessage> {
  readonly #values: SDKUserMessage[] = [];
  readonly #waiters: Array<(result: IteratorResult<SDKUserMessage>) => void> = [];
  #closed = false;

  push(value: SDKUserMessage): void {
    if (this.#closed) throw new Error("Claude input queue is closed.");
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.#values.push(value);
  }

  close(): void {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value) return Promise.resolve({ done: false, value });
        if (this.#closed) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

function readThreadConfig(params: unknown): ThreadConfig {
  const roots =
    isRecord(params) && Array.isArray(params.runtimeWorkspaceRoots)
      ? params.runtimeWorkspaceRoots.filter((value): value is string => isString(value))
      : [];
  const cwd = requiredString(params, "cwd");
  return {
    cwd,
    model: getString(params, "model") ?? undefined,
    effort: getString(params, "effort") ?? undefined,
    developerInstructions: getString(params, "developerInstructions") ?? "",
    additionalDirectories: [...new Set([cwd, ...roots])],
    persistSession: !isRecord(params) || params.persistSession !== false,
    profileGeneration: isRecord(params) && params.profileGeneration === true,
    computerUse: computerUseParam(params),
    workspaceOnly: isRecord(params) && params.sandbox === "workspace-write",
  };
}

function requiredString(value: unknown, key: string): string {
  const result = getString(value, key);
  if (!result) throw new Error(`${key} is required.`);
  return result;
}

function parseAuthStatus(stdout: unknown): DynamicRecord | null {
  if (!isString(stdout)) return null;
  try {
    const status = JSON.parse(stdout);
    return isRecord(status) && typeof status.loggedIn === "boolean" ? status : null;
  } catch {
    return null;
  }
}

function readInputText(params: unknown): string {
  if (!isRecord(params) || !Array.isArray(params.input)) return "";
  return params.input
    .filter(isRecord)
    .filter((item) => item.type === "text" && isString(item.text))
    .map((item) => item.text)
    .join("\n");
}

function messageText(message: unknown): string {
  if (!isRecord(message)) return "";
  if (isString(message.content)) return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter(isRecord)
    .filter((block) => block.type === "text" && isString(block.text))
    .map((block) => block.text)
    .join("\n");
}

/** The text a message placed before its first thinking block, with the break that follows it. */
function textBeforeThinking(message: unknown): string {
  if (!isRecord(message) || !Array.isArray(message.content)) return "";
  const blocks = message.content.filter(isRecord);
  const boundary = blocks.findIndex((block) => block.type === "thinking");
  if (boundary < 0) return "";
  const before = blocks
    .slice(0, boundary)
    .filter((block) => block.type === "text" && isString(block.text))
    .map((block) => String(block.text));
  if (before.length === 0) return "";
  const follows = blocks.slice(boundary + 1).some((block) => block.type === "text" && isString(block.text));
  return `${before.join("\n")}${follows ? "\n" : ""}`;
}

function messageThinking(message: unknown): string {
  if (!isRecord(message) || !Array.isArray(message.content)) return "";
  return message.content
    .filter(isRecord)
    .filter((block) => block.type === "thinking")
    .map((block) => getString(block, "thinking"))
    .filter(isString)
    .join("\n");
}

function messageToolCalls(message: unknown): Array<{ id: string; name: string }> {
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isRecord).flatMap((block) => {
    const id = getString(block, "id");
    const name = getString(block, "name");
    return block.type === "tool_use" && id && name ? [{ id, name }] : [];
  });
}

function messageToolResults(message: unknown): string[] {
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  return message.content
    .filter(isRecord)
    .filter((block) => block.type === "tool_result")
    .map((block) => getString(block, "tool_use_id"))
    .filter(isString);
}

function dynamicContent(value: unknown): CallToolResult["content"] {
  if (!isRecord(value)) return [];
  if (value.type === "inputText" && isString(value.text)) {
    return [{ type: "text" as const, text: value.text }];
  }
  if (value.type === "inputImage" && isString(value.imageUrl)) {
    const [, mimeType, data] = value.imageUrl.match(/^data:([^;]+);base64,(.+)$/s) ?? [];
    if (mimeType !== undefined && data !== undefined) return [{ type: "image" as const, mimeType, data }];
  }
  return [];
}

function normalizeClaudeModel(model: string): string {
  return model.startsWith("claude-") ? model : defaultProviderModel("claude");
}

function normalizeClaudeEffort(effort: string): ClaudeEffort {
  return isOneOf(CLAUDE_EFFORTS, effort) ? effort : "high";
}

function isUuid(value: string): value is UUID {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
