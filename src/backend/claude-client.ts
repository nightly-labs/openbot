import { execFile } from "node:child_process";
import { randomUUID, type UUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import {
  type CanUseTool,
  createSdkMcpServer,
  getSessionMessages,
  type ModelInfo,
  type PermissionResult,
  query,
  type SDKUserMessage,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type DynamicRecord, isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import type { AgentProvider } from "./agent-client";
import { BROWSER_TOOL_DEFINITIONS, OPENBOT_BROWSER_NAMESPACE } from "./browser-tools";
import type { ClaudeCliInfo } from "./cli";
import { OPENBOT_TOOL_DEFINITIONS } from "./openbot-tools";
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
}

interface ActiveTurn {
  id: string;
  itemId: string;
  reasoningItemId: string;
  text: string;
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
}

interface PendingServerRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

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
  readonly #threads = new Map<string, ThreadRuntime>();
  readonly #pendingServerRequests = new Map<RequestId, PendingServerRequest>();
  readonly #modelEffortCapabilities = new Map<string, ClaudeEffortCapability>();
  readonly #modelSdkValues = new Map<string, string>();
  #running = false;

  constructor(
    cli: ClaudeCliInfo,
    createQuery: QueryFactory = query,
    readSessionMessages: SessionHistoryReader = getSessionMessages,
    requestTimeoutMs = 30_000,
  ) {
    super();
    this.#cli = cli;
    this.#createQuery = createQuery;
    this.#readSessionMessages = readSessionMessages;
    this.#requestTimeoutMs = requestTimeoutMs;
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    this.#running = true;
  }

  async stop(): Promise<void> {
    this.#running = false;
    for (const runtime of this.#threads.values()) {
      runtime.input.close();
      runtime.query.close();
    }
    await Promise.allSettled([...this.#threads.values()].map((runtime) => runtime.consume));
    this.#threads.clear();
    for (const pending of this.#pendingServerRequests.values()) {
      pending.reject(new Error("Claude session stopped."));
    }
    this.#pendingServerRequests.clear();
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
        const current = this.#threads.get(threadId);
        if (current && JSON.stringify(current.config) !== JSON.stringify(config)) {
          if (current.activeTurn) throw new Error("Wait for the active Claude turn before refreshing its context.");
          this.#threads.delete(threadId);
          current.input.close();
          current.query.close();
          await current.consume;
        }
        if (!this.#threads.has(threadId)) {
          await this.#startThread(threadId, config, true);
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
        const runtime = this.#requireThread(requiredString(params, "threadId"));
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
    const pending = this.#pendingServerRequests.get(id);
    if (!pending) return;
    this.#pendingServerRequests.delete(id);
    pending.resolve(result);
  }

  respondError(id: RequestId, error: RpcError): void {
    const pending = this.#pendingServerRequests.get(id);
    if (!pending) return;
    this.#pendingServerRequests.delete(id);
    pending.reject(new Error(error.message));
  }

  async #listModels(timeoutMs?: number): Promise<unknown[]> {
    const input = new AsyncMessageQueue();
    const claudeQuery = this.#createQuery({
      prompt: input,
      options: {
        cwd: process.cwd(),
        pathToClaudeCodeExecutable: this.#cli.executable,
        settingSources: ["user", "project", "local"],
        persistSession: false,
        env: { ...claudeEnvironment(this.#cli), CLAUDE_AGENT_SDK_CLIENT_APP: "openbot/0.1.0" },
      },
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
                  reject(new Error("Claude request timed out: model/list"));
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
      options: {
        cwd: process.cwd(),
        pathToClaudeCodeExecutable: this.#cli.executable,
        settingSources: ["user", "project", "local"],
        persistSession: false,
        env: { ...claudeEnvironment(this.#cli), CLAUDE_AGENT_SDK_CLIENT_APP: "openbot/0.1.0" },
      },
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
            reject(new Error("Claude request timed out: account/rateLimits/read"));
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
    try {
      const { stdout } = await execFileAsync(this.#cli.executable, ["auth", "status", "--json"], {
        timeout: 5_000,
        maxBuffer: 64 * 1024,
        shell: process.platform === "win32",
        env: claudeEnvironment(this.#cli),
      });
      const status = JSON.parse(stdout);
      if (!isRecord(status) || status.loggedIn !== true) {
        return { account: null, requiresOpenaiAuth: false };
      }
      return {
        account: {
          type: "claude",
          email: isString(status.email) ? status.email : null,
          planType: isString(status.subscriptionType) ? status.subscriptionType : null,
        },
        requiresOpenaiAuth: false,
      };
    } catch {
      return { account: null, requiresOpenaiAuth: false };
    }
  }

  async #startThread(threadId: string, config: ThreadConfig, resume: boolean): Promise<void> {
    const input = new AsyncMessageQueue();
    const appliedEffort = this.#resolveEffort(config.model, config.effort);
    const canUseTool: CanUseTool = async (toolName, toolInput, options) => {
      if (config.profileGeneration) return { behavior: "deny", message: "Profile generation has no tools." };
      if (toolName !== "AskUserQuestion") {
        return { behavior: "allow", updatedInput: toolInput } satisfies PermissionResult;
      }
      return this.#requestUserInput(threadId, toolInput, options.toolUseID ?? randomUUID());
    };
    const mcpServers = config.profileGeneration ? {} : this.#createOpenBotServers(threadId);
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
        ...(config.profileGeneration ? { tools: [] } : {}),
        settingSources: config.profileGeneration ? [] : ["user", "project", "local"],
        permissionMode: "default",
        includePartialMessages: true,
        persistSession: config.persistSession,
        additionalDirectories: config.additionalDirectories,
        canUseTool,
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
    };
    runtime.consume = this.#consume(runtime);
    this.#threads.set(threadId, runtime);
  }

  async #startTurn(params: unknown): Promise<TurnResponse> {
    const threadId = requiredString(params, "threadId");
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
      thinking: "",
      thinkingStarted: false,
      thinkingStreamId: null,
      assistantMessages: new Map<string, string>(),
      thinkingMessages: new Map<string, string>(),
      toolCalls: new Map<string, string>(),
    };
    runtime.activeTurn = activeTurn;
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
        if (delta.type === "text_delta" && isString(delta.text)) this.#appendDelta(runtime, delta.text);
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
      if (thinking) {
        turn.thinkingMessages.set(message.uuid, thinking);
        const completeThinking = [...turn.thinkingMessages.values()].join("\n");
        if (completeThinking.startsWith(turn.thinking)) {
          this.#appendThinkingDelta(runtime, completeThinking.slice(turn.thinking.length));
        }
      }
      for (const toolCall of messageToolCalls(message.message)) {
        if (turn.toolCalls.has(toolCall.id)) continue;
        turn.toolCalls.set(toolCall.id, toolCall.name);
        this.#emitToolCall(runtime, toolCall.id, toolCall.name, false);
      }
      if (!text) return;
      turn.assistantMessages.set(message.uuid, text);
      const completeText = [...turn.assistantMessages.values()].join("");
      if (completeText.startsWith(turn.text)) {
        this.#appendDelta(runtime, completeText.slice(turn.text.length));
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
      const completeText = [...turn.assistantMessages.values()].join("");
      if (completeText) turn.text = completeText;
      else if (!turn.text && fallback) this.#appendDelta(runtime, fallback);
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

  #appendDelta(runtime: ThreadRuntime, delta: string): void {
    const turn = runtime.activeTurn;
    if (!turn || !delta) return;
    turn.text += delta;
    this.emit("notification", {
      method: "item/agentMessage/delta",
      params: {
        threadId: runtime.id,
        turnId: turn.id,
        itemId: turn.itemId,
        delta,
      },
    });
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
  }

  async #readThread(threadId: string): Promise<ThreadResponse> {
    const runtime = this.#threads.get(threadId);
    const messages = await this.#readSessionMessages(
      threadId,
      runtime?.config.cwd ? { dir: runtime.config.cwd } : undefined,
    );
    const turns: NonNullable<ThreadResponse["thread"]["turns"]> = [];
    let current: (typeof turns)[number] | null = null;
    let currentThinking: ThreadItem | null = null;
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
      } else if (message.type === "assistant") {
        const thinking = messageThinking(message.message);
        if (!thinking && !text) continue;
        if (!current) {
          current = { id: message.uuid, status: "completed", items: [] };
          turns.push(current);
          currentThinking = null;
        }
        if (thinking) {
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
        if (text) current.items?.push({ id: message.uuid, type: "agentMessage", text });
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
    const result = await this.#callServerRequest("item/tool/call", {
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
    const result = await this.#callServerRequest("item/tool/requestUserInput", {
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

  #callServerRequest(method: string, params: unknown): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.#pendingServerRequests.set(id, { resolve, reject });
      this.emit("request", { id, method, params });
    });
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
  };
}

function requiredString(value: unknown, key: string): string {
  const result = getString(value, key);
  if (!result) throw new Error(`${key} is required.`);
  return result;
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
    const match = value.imageUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (match) return [{ type: "image" as const, mimeType: match[1], data: match[2] }];
  }
  return [];
}

function normalizeClaudeModel(model: string): string {
  return model.startsWith("claude-") ? model : "claude-opus-5";
}

function normalizeClaudeEffort(effort: string): ClaudeEffort {
  return isOneOf(CLAUDE_EFFORTS, effort) ? effort : "high";
}

function isUuid(value: string): value is UUID {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
