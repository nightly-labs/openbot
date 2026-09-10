import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  type ContentBlock,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type ElicitationContentValue,
  type InitializeResponse,
  ndJsonStream,
  type PermissionOption,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import { agentProviderName } from "@openbot/contracts/agent-providers";
import { type DynamicRecord, isBoolean, isString } from "@openbot/contracts/runtime-values";
import { redactText } from "@openbot/logging";
import type { AgentProvider } from "./agent-client";
import type { AgentCliInfo } from "./cli";
import { type DynamicToolNamespace, LocalMcpBridge, type LocalMcpSession } from "./local-mcp-bridge";
import {
  type AccountRateLimitsReadResult,
  type AppServerNotification,
  type AppServerRequest,
  type DynamicToolResult,
  getArray,
  getRecord,
  getString,
  isRecord,
  type RequestId,
  type ResponseDecoder,
  type RpcError,
  type ThreadItem,
} from "./protocol";

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string];
}

interface PendingServerRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface AcpTurn {
  id: string;
  itemId: string;
  thoughtItemId: string;
  text: string;
  thought: string;
  thoughtStarted: boolean;
  receivedOutput: boolean;
  messages: ThreadItem[];
  task: Promise<void>;
}

interface AcpThread {
  id: string;
  cwd: string;
  developerInstructions: string;
  configOptions: SessionConfigOption[];
  currentModelId: string | null;
  mcp: LocalMcpSession;
  activeTurn: AcpTurn | null;
  turns: Array<{ id: string; status: string; items: ThreadItem[] }>;
}

interface AcpModel {
  id: string;
  name: string;
  description: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: string[];
  reasoningEffortWireValues: Map<string, string>;
  usesModelReasoningEffort: boolean | null;
}

export interface AcpProviderOptions {
  provider: AgentProvider;
  profileGeneration?: boolean;
  argv: readonly string[];
  env: Record<string, string>;
  /**
   * Variables read once per spawn rather than once per client, which is what lets a key saved after
   * construction reach the next process without any other plumbing. Spread after `env`.
   */
  extraEnv?: () => Record<string, string>;
  signInMessage: string;
  authenticate?(connection: ClientSideConnection, initialization: InitializeResponse): Promise<void>;
  readRateLimits?(connection: ClientSideConnection): Promise<AccountRateLimitsReadResult>;
}

export class AcpAgentClient extends EventEmitter<ClientEvents> {
  get provider(): AgentProvider {
    return this.options.provider;
  }
  readonly #cli: AgentCliInfo;
  readonly #requestTimeoutMs: number;
  readonly #bridge = new LocalMcpBridge();
  readonly #threads = new Map<string, AcpThread>();
  readonly #pendingServerRequests = new Map<RequestId, PendingServerRequest>();
  #process: ChildProcessWithoutNullStreams | null = null;
  #connection: ClientSideConnection | null = null;
  #initialized: Promise<void> | null = null;
  #initialization: InitializeResponse | null = null;
  #models: AcpModel[] = [];
  #signedIn = false;
  #stopping = false;

  constructor(
    cli: AgentCliInfo,
    requestTimeoutMs = 30_000,
    private readonly options: AcpProviderOptions,
  ) {
    super();
    this.#cli = cli;
    this.#requestTimeoutMs = requestTimeoutMs;
  }

  get running(): boolean {
    return this.#process !== null && this.#process.exitCode === null && !this.#stopping;
  }

  start(): void {
    if (this.running) return;
    this.#stopping = false;
    const child = spawn(this.#cli.executable, [...this.options.argv], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.options.env, ...this.options.extraEnv?.() },
      shell: process.platform === "win32",
      windowsHide: true,
    });
    this.#process = child;
    const stream = ndJsonStream(
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: Node and DOM declare the same Web Stream ABI with incompatible generic variance.
      Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: Node and DOM declare the same Web Stream ABI with incompatible generic variance.
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
    );
    this.#connection = new ClientSideConnection(
      () => ({
        requestPermission: (params) => this.#requestPermission(params),
        sessionUpdate: (params) => this.#sessionUpdate(params),
        createElicitation: (params) => this.#createElicitation(params),
        extMethod: (method, params) => this.#requestUserInput(method, params),
      }),
      stream,
    );
    child.stderr.on("data", (chunk: Buffer) => {
      const message = redactText(chunk.toString("utf8").trim());
      if (message) this.emit("diagnostic", message);
    });
    child.once("error", (error) => this.#fail(error, child));
    child.once("exit", (code, signal) => {
      const suffix = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      this.#fail(new Error(`ACP process exited with ${suffix}.`), child);
    });
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    const child = this.#process;
    this.#process = null;
    this.#connection = null;
    this.#initialized = null;
    for (const thread of this.#threads.values()) thread.mcp.close();
    this.#threads.clear();
    for (const pending of this.#pendingServerRequests.values()) pending.reject(new Error("ACP session stopped."));
    this.#pendingServerRequests.clear();
    await this.#bridge.close();
    if (!child || child.exitCode !== null) return;
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(forceKill);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  async request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number): Promise<T> {
    if (!this.running) throw new Error("ACP client is not running.");
    switch (method) {
      case "initialize":
        await this.#ensureInitialized();
        return decoder({});
      case "account/read":
        return decoder({
          account: this.#signedIn ? { type: this.provider, email: null, planType: null } : null,
          requiresOpenaiAuth: false,
        });
      case "account/rateLimits/read":
        await this.#ensureInitialized();
        if (!this.#signedIn) return decoder({ rateLimits: null, rateLimitsByLimitId: null });
        return decoder(
          this.options.readRateLimits
            ? await withTimeout(
                this.options.readRateLimits(this.#requireConnection()),
                timeoutMs ?? this.#requestTimeoutMs,
                `${agentProviderName(this.provider)} request timed out: account/rateLimits/read`,
              )
            : { rateLimits: null, rateLimitsByLimitId: null },
        );
      case "model/list":
        await this.#ensureInitialized();
        if (this.#signedIn) this.#models = await this.#discoverModels(timeoutMs);
        return decoder({
          data: this.#models.map((model) => ({
            model: model.id,
            displayName: model.name,
            description: model.description,
            defaultReasoningEffort: model.defaultReasoningEffort,
            supportedReasoningEfforts: model.supportedReasoningEfforts.map((reasoningEffort) => ({ reasoningEffort })),
          })),
        });
      case "plugin/list":
        return decoder({ marketplaces: [] });
      case "thread/start":
        return decoder(await this.#startThread(params, false));
      case "thread/resume":
        return decoder(await this.#startThread(params, true));
      case "thread/read": {
        const thread = this.#requireThread(requiredString(params, "threadId"));
        return decoder({ thread: { id: thread.id, turns: thread.turns } });
      }
      case "turn/start":
        return decoder(await this.#startTurn(params, false));
      case "turn/steer":
        return decoder(await this.#startTurn(params, true));
      case "turn/interrupt": {
        const thread = this.#requireThread(requiredString(params, "threadId"));
        this.#requireConnection().cancel({ sessionId: thread.id });
        return decoder({});
      }
      case "thread/compact/start":
        return decoder({});
      default:
        throw new Error(`ACP adapter does not implement ${method}.`);
    }
  }

  notify(): void {
    // ACP initialization is a request/response exchange without a follow-up notification.
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

  async #ensureInitialized(): Promise<void> {
    if (this.#initialized) return this.#initialized;
    this.#initialized = this.#initialize();
    return this.#initialized;
  }

  async #initialize(): Promise<void> {
    const connection = this.#requireConnection();
    this.#initialization = await withTimeout(
      connection.initialize({
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
          elicitation: { form: {} },
          session: { configOptions: { boolean: {} } },
        },
        clientInfo: { name: "openbot", title: "OpenBot", version: "0.1.0" },
      }),
      this.#requestTimeoutMs,
      "ACP initialization timed out.",
    );
    try {
      await this.options.authenticate?.(connection, this.#initialization);
      this.#models = await this.#discoverModels();
      if (this.#models.length === 0) {
        throw new Error("ACP CLI did not advertise any ACP models. OpenBot will not guess a fallback model.");
      }
      this.#signedIn = true;
    } catch (error) {
      if (isAuthenticationError(error)) {
        this.#signedIn = false;
        return;
      }
      throw error;
    }
  }

  async #discoverModels(timeoutMs = this.#requestTimeoutMs): Promise<AcpModel[]> {
    const connection = this.#requireConnection();
    return withTimeout(
      (async () => {
        const probe = await connection.newSession({ cwd: process.cwd(), mcpServers: [] });
        try {
          return modelsFromSessionSetup(probe);
        } finally {
          await connection.closeSession({ sessionId: probe.sessionId }).catch(() => undefined);
        }
      })(),
      timeoutMs,
      `${agentProviderName(this.provider)} request timed out: model/list`,
    );
  }

  async #startThread(params: unknown, resume: boolean): Promise<{ thread: { id: string } }> {
    await this.#ensureInitialized();
    if (!this.#signedIn) throw new Error(this.options.signInMessage);
    const requestedThreadId = getString(params, "threadId");
    if (resume && requestedThreadId && this.#threads.has(requestedThreadId))
      return { thread: { id: requestedThreadId } };
    const cwd = requiredString(params, "cwd");
    const dynamicTools = getArray(params, "dynamicTools").filter(isDynamicToolNamespace);
    let threadRef: AcpThread | null = null;
    const mcp = await this.#bridge.createSession(
      requestedThreadId ?? randomUUID(),
      dynamicTools,
      () => threadRef?.activeTurn?.id ?? null,
      (call) => this.#callDynamicTool(call),
    );
    try {
      const connection = this.#requireConnection();
      const additionalDirectories = getArray(params, "runtimeWorkspaceRoots").filter(isString);
      let id: string;
      let configOptions: SessionConfigOption[];
      let currentModelId: string | null;
      if (resume && requestedThreadId) {
        const response = await connection.loadSession({
          sessionId: requestedThreadId,
          cwd,
          additionalDirectories,
          mcpServers: mcp.servers,
        });
        id = requestedThreadId;
        configOptions = response.configOptions ?? [];
        currentModelId = currentModelFromSessionSetup(response);
      } else {
        const response = await connection.newSession({ cwd, additionalDirectories, mcpServers: mcp.servers });
        id = response.sessionId;
        configOptions = response.configOptions ?? [];
        currentModelId = currentModelFromSessionSetup(response);
      }
      mcp.setThreadId(id);
      const thread: AcpThread = {
        id,
        cwd,
        developerInstructions: getString(params, "developerInstructions") ?? "",
        configOptions,
        currentModelId,
        mcp,
        activeTurn: null,
        turns: [],
      };
      threadRef = thread;
      this.#threads.set(id, thread);
      await this.#applyConfig(thread, getString(params, "model"), getString(params, "effort"));
      return { thread: { id } };
    } catch (error) {
      mcp.close();
      throw error;
    }
  }

  async #applyConfig(thread: AcpThread, model: string | null, effort: string | null): Promise<void> {
    for (const [category, value] of [
      ["model", model],
      ["thought_level", effort],
    ] as const) {
      if (!value) continue;
      if (category === "thought_level" && thread.currentModelId) {
        const currentModel = this.#models.find((candidate) => candidate.id === thread.currentModelId);
        if (currentModel && currentModel.usesModelReasoningEffort !== null) {
          if (currentModel.usesModelReasoningEffort && currentModel.supportedReasoningEfforts.includes(value)) {
            await this.#requireConnection().request("session/set_model", {
              sessionId: thread.id,
              modelId: thread.currentModelId,
              _meta: { reasoningEffort: currentModel.reasoningEffortWireValues.get(value) ?? value },
            });
          }
          continue;
        }
      }
      const option = thread.configOptions.find(
        (candidate): candidate is Extract<SessionConfigOption, { type: "select" }> =>
          candidate.category === category && candidate.type === "select",
      );
      if (!option) {
        if (category === "model" && thread.currentModelId !== value) {
          await this.#requireConnection().request("session/set_model", {
            sessionId: thread.id,
            modelId: value,
          });
          thread.currentModelId = value;
        }
        continue;
      }
      const selected = selectValues(option).find((candidate) =>
        category === "thought_level" ? normalizeEffort(candidate.value) === value : candidate.value === value,
      );
      if (!selected) continue;
      const response = await this.#requireConnection().setSessionConfigOption({
        sessionId: thread.id,
        configId: option.id,
        value: selected.value,
      });
      thread.configOptions = response.configOptions;
      if (category === "model") thread.currentModelId = selected.value;
    }
  }

  async #startTurn(
    params: unknown,
    steer: boolean,
  ): Promise<{ turn: { id: string; status: string }; turnId?: string }> {
    const thread = this.#requireThread(requiredString(params, "threadId"));
    if (!steer && thread.activeTurn) throw new Error("The ACP thread already has an active turn.");
    if (steer && !thread.activeTurn) throw new Error("The ACP thread has no active turn to steer.");
    await this.#applyConfig(thread, getString(params, "model"), getString(params, "effort"));
    const activeTurn = thread.activeTurn;
    const turnId = steer && activeTurn ? activeTurn.id : (getString(params, "clientUserMessageId") ?? randomUUID());
    const blocks = await promptBlocks(params);
    if (!steer && thread.developerInstructions) {
      blocks.unshift({
        type: "text",
        text: `<openbot-developer-instructions>\n${thread.developerInstructions}\n</openbot-developer-instructions>`,
      });
    }
    if (steer) {
      void this.#requireConnection()
        .prompt({ sessionId: thread.id, prompt: blocks })
        .catch((error) => {
          this.emit("diagnostic", redactText(`ACP steer failed: ${String(error)}`));
        });
      return { turn: { id: turnId, status: "inProgress" }, turnId };
    }
    const turn: AcpTurn = {
      id: turnId,
      itemId: `${turnId}:assistant`,
      thoughtItemId: `${turnId}:thought`,
      text: "",
      thought: "",
      thoughtStarted: false,
      receivedOutput: false,
      messages: [],
      task: Promise.resolve(),
    };
    thread.activeTurn = turn;
    this.emit("notification", {
      method: "turn/started",
      params: { threadId: thread.id, turn: { id: turn.id, status: "inProgress" } },
    });
    turn.task = this.#consumePrompt(thread, turn, blocks);
    return { turn: { id: turn.id, status: "inProgress" } };
  }

  async #consumePrompt(thread: AcpThread, turn: AcpTurn, prompt: ContentBlock[]): Promise<void> {
    try {
      const response = await this.#requireConnection().prompt({ sessionId: thread.id, prompt });
      if (response.usage)
        this.emit("notification", {
          method: "openbot/usage",
          params: { threadId: thread.id, turnId: turn.id, usage: response.usage },
        });
      // OpenCode can swallow provider errors and report a successful, empty ACP turn.
      // Do not invent the upstream cause or report that turn as a successful reply.
      if (this.provider === "opencode" && response.stopReason === "end_turn" && !turn.receivedOutput) {
        this.#completeTurn(
          thread,
          turn,
          "failed",
          "OpenCode returned no response. Check the selected model's sign-in and billing in OpenCode, then retry or choose another model.",
        );
        return;
      }
      const status =
        response.stopReason === "cancelled"
          ? "interrupted"
          : response.stopReason === "end_turn"
            ? "completed"
            : "failed";
      this.#completeTurn(thread, turn, status, status === "failed" ? response.stopReason : null);
    } catch (error) {
      this.#completeTurn(thread, turn, "failed", error);
    }
  }

  #sessionUpdate(notification: SessionNotification): void {
    const thread = this.#threads.get(notification.sessionId);
    if (!thread) return;
    const turn = thread.activeTurn;
    const update = notification.update;
    if (!turn) return;
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
      if (update.content.text) this.#completeThought(thread, turn);
      if (update.content.text.trim()) turn.receivedOutput = true;
      turn.text += update.content.text;
      return;
    }
    if (update.sessionUpdate === "agent_thought_chunk" && update.content.type === "text") {
      this.#completeMessage(thread, turn, "commentary");
      /* A delta carries no phase, so the item has to be opened as `commentary` first — otherwise the
         thought lands in an ordinary agentMessage and renders as a chat bubble. */
      if (!turn.thoughtStarted) {
        turn.thoughtStarted = true;
        this.emit("notification", {
          method: "item/started",
          params: {
            threadId: thread.id,
            turnId: turn.id,
            item: { id: turn.thoughtItemId, type: "agentMessage", phase: "commentary" },
          },
        });
      }
      turn.thought += update.content.text;
      this.emit("notification", {
        method: "item/agentMessage/delta",
        params: { threadId: thread.id, turnId: turn.id, itemId: turn.thoughtItemId, delta: update.content.text },
      });
      return;
    }
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      turn.receivedOutput = true;
      if (update.sessionUpdate === "tool_call") this.#completeMessage(thread, turn, "commentary");
      this.emit("notification", {
        method: update.status === "completed" || update.status === "failed" ? "item/completed" : "item/started",
        params: {
          threadId: thread.id,
          turnId: turn.id,
          item: {
            id: update.toolCallId,
            type: "toolCall",
            name: update.name ?? update.title ?? "tool",
            status: update.status,
            arguments: update.rawInput,
            result: update.rawOutput,
          },
        },
      });
      return;
    }
    if (update.sessionUpdate === "plan") {
      const text = update.entries
        .map((entry) => `- [${entry.status === "completed" ? "x" : " "}] ${entry.content}`)
        .join("\n");
      this.emit("notification", {
        method: "item/completed",
        params: {
          threadId: thread.id,
          turnId: turn.id,
          item: { id: `${turn.id}:plan`, type: "agentMessage", phase: "analysis", text },
        },
      });
    }
  }

  // ACP cannot identify final text while streaming. Buffer unclassified text privately,
  // publishing commentary at a later step boundary or an answer when the prompt finishes.
  #completeMessage(thread: AcpThread, turn: AcpTurn, phase: "commentary" | "final_answer"): void {
    if (!turn.text) return;
    const item = { id: turn.itemId, type: "agentMessage", phase, text: turn.text } satisfies ThreadItem;
    turn.messages.push(item);
    this.emit("notification", { method: "item/completed", params: { threadId: thread.id, turnId: turn.id, item } });
    turn.text = "";
    turn.itemId = `${turn.id}:assistant:${turn.messages.length}`;
  }

  #completeThought(thread: AcpThread, turn: AcpTurn): void {
    if (!turn.thoughtStarted) return;
    const item = {
      id: turn.thoughtItemId,
      type: "agentMessage",
      phase: "commentary",
      text: turn.thought,
    } satisfies ThreadItem;
    turn.messages.push(item);
    this.emit("notification", { method: "item/completed", params: { threadId: thread.id, turnId: turn.id, item } });
    turn.thought = "";
    turn.thoughtStarted = false;
    turn.thoughtItemId = `${turn.id}:thought:${turn.messages.length}`;
  }

  #completeTurn(thread: AcpThread, turn: AcpTurn, status: string, error: unknown): void {
    if (thread.activeTurn !== turn) return;
    this.#completeThought(thread, turn);
    this.#completeMessage(thread, turn, "final_answer");
    if (status === "failed" && error) {
      this.emit("notification", {
        method: "error",
        params: { threadId: thread.id, turnId: turn.id, message: redactText(String(error)) },
      });
    }
    this.emit("notification", {
      method: "turn/completed",
      params: { threadId: thread.id, turn: { id: turn.id, status } },
    });
    thread.turns.push({ id: turn.id, status, items: turn.messages });
    thread.activeTurn = null;
  }

  async #requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    if (this.options.profileGeneration) return { outcome: { outcome: "cancelled" } };
    const thread = this.#threads.get(params.sessionId);
    const turnId = thread?.activeTurn?.id ?? randomUUID();
    const kind =
      params.toolCall.kind === "execute"
        ? "command"
        : ["edit", "delete", "move"].includes(params.toolCall.kind ?? "")
          ? "file-change"
          : "permissions";
    const requestedPermissions = kind === "permissions" ? { [params.toolCall.kind ?? "file-system"]: true } : null;
    const result = await this.#callServerRequest(
      `item/${kind === "command" ? "commandExecution" : kind === "file-change" ? "fileChange" : "permissions"}/requestApproval`,
      {
        threadId: params.sessionId,
        turnId,
        command: params.toolCall.kind === "execute" ? printableInput(params.toolCall.rawInput) : null,
        reason: params.toolCall.title ?? null,
        permissions: requestedPermissions,
        acpOptions: params.options,
      },
    );
    const accepted =
      isRecord(result) &&
      (result.decision === "accept" ||
        result.decision === "approved" ||
        (isRecord(result.permissions) && Object.keys(result.permissions).length > 0));
    const option = bestPermissionOption(params.options, accepted);
    return option
      ? { outcome: { outcome: "selected", optionId: option.optionId } }
      : { outcome: { outcome: "cancelled" } };
  }

  async #requestUserInput(method: string, params: DynamicRecord): Promise<DynamicRecord> {
    const sessionId = getString(params, "sessionId") ?? [...this.#threads.keys()][0];
    const thread = sessionId ? this.#threads.get(sessionId) : undefined;
    const result = await this.#callServerRequest("item/tool/requestUserInput", {
      ...params,
      threadId: sessionId,
      turnId: thread?.activeTurn?.id ?? randomUUID(),
      sourceMethod: method,
    });
    return isRecord(result) ? result : {};
  }

  async #createElicitation(params: CreateElicitationRequest): Promise<CreateElicitationResponse> {
    const schema = getRecord(params, "requestedSchema");
    const properties = getRecord(schema, "properties") ?? {};
    const questions = Object.entries(properties).flatMap(([id, rawProperty]) => {
      if (!isRecord(rawProperty)) return [];
      const property = rawProperty;
      return [
        {
          id,
          header: getString(property, "title") ?? id,
          question: getString(property, "description") ?? getString(params, "message") ?? "ACP needs more information.",
          options: elicitationOptions(property),
        },
      ];
    });
    if (questions.length === 0) {
      questions.push({
        id: "response",
        header: "ACP",
        question: getString(params, "message") ?? "ACP needs confirmation.",
        options: null,
      });
    }
    const result = await this.#requestUserInput("session/elicitation", { ...params, questions });
    const answers = isRecord(result.answers) ? result.answers : null;
    if (!answers) return { action: "decline" };
    const content: Record<string, ElicitationContentValue> = {};
    for (const [id, answerValue] of Object.entries(answers)) {
      const answer = isRecord(answerValue) ? getArray(answerValue, "answers").filter(isString) : [];
      if (answer.length === 0) continue;
      content[id] = elicitationValue(isRecord(properties[id]) ? properties[id] : undefined, answer);
    }
    return Object.keys(content).length > 0 ? { action: "accept", content } : { action: "decline" };
  }

  async #callDynamicTool(params: {
    threadId: string;
    turnId: string;
    callId: string;
    namespace: string;
    tool: string;
    arguments: unknown;
  }): Promise<DynamicToolResult> {
    const result = await this.#callServerRequest("item/tool/call", params);
    if (!isDynamicToolResult(result)) throw new Error("OpenBot returned an invalid dynamic tool result.");
    return result;
  }

  #callServerRequest(method: string, params: unknown): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.#pendingServerRequests.set(id, { resolve, reject });
      this.emit("request", { id, method, params });
    });
  }

  #requireThread(id: string): AcpThread {
    const thread = this.#threads.get(id);
    if (!thread) throw new Error(`Unknown ACP session: ${id}`);
    return thread;
  }

  #requireConnection(): ClientSideConnection {
    if (!this.#connection) throw new Error("ACP connection is not running.");
    return this.#connection;
  }

  #fail(error: Error, child: ChildProcessWithoutNullStreams): void {
    if (this.#process !== child) return;
    this.#process = null;
    if (!this.#stopping) this.emit("exit", error);
  }
}

function isDynamicToolNamespace(value: unknown): value is DynamicToolNamespace {
  return (
    isRecord(value) &&
    value.type === "namespace" &&
    isString(value.name) &&
    Array.isArray(value.tools) &&
    value.tools.every(
      (tool) => isRecord(tool) && tool.type === "function" && isString(tool.name) && isRecord(tool.inputSchema),
    )
  );
}

interface SessionSetupResponse {
  configOptions?: SessionConfigOption[] | null;
  models?: unknown;
}

function modelsFromSessionSetup(response: SessionSetupResponse): AcpModel[] {
  const options = sessionConfigOptions(response);
  const discovered = availableModels(response);
  if (discovered.length === 0) return modelsFromConfig(options);
  const configReasoning = reasoningFromConfig(options);
  return discovered.map((model) => {
    const supportedReasoningEfforts = model.supportedReasoningEfforts ?? configReasoning.supportedReasoningEfforts;
    const reasoningEffortWireValues = model.reasoningEffortWireValues;
    const defaultReasoningEffort =
      model.defaultReasoningEffort && supportedReasoningEfforts.includes(model.defaultReasoningEffort)
        ? model.defaultReasoningEffort
        : supportedReasoningEfforts.includes(configReasoning.defaultReasoningEffort)
          ? configReasoning.defaultReasoningEffort
          : (supportedReasoningEfforts[0] ?? "medium");
    return {
      id: model.id,
      name: model.name,
      description: model.description ?? "Model discovered from ACP CLI through ACP.",
      defaultReasoningEffort,
      supportedReasoningEfforts,
      reasoningEffortWireValues:
        reasoningEffortWireValues && reasoningEffortWireValues.size > 0
          ? reasoningEffortWireValues
          : configReasoning.reasoningEffortWireValues,
      usesModelReasoningEffort: model.usesModelReasoningEffort,
    };
  });
}

function modelsFromConfig(options: SessionConfigOption[]): AcpModel[] {
  const model = options.find(
    (option): option is Extract<SessionConfigOption, { type: "select" }> =>
      option.category === "model" && option.type === "select",
  );
  if (!model) return [];
  const reasoning = reasoningFromConfig(options);
  return selectValues(model).map((option) => ({
    id: option.value,
    name: option.name,
    description: option.description ?? "Model discovered from ACP CLI through ACP.",
    ...reasoning,
    usesModelReasoningEffort: null,
  }));
}

function reasoningFromConfig(
  options: SessionConfigOption[],
): Pick<AcpModel, "defaultReasoningEffort" | "supportedReasoningEfforts" | "reasoningEffortWireValues"> {
  const thought = options.find((option) => option.category === "thought_level" && option.type === "select");
  const wireValues = reasoningEffortWireValues(
    thought && thought.type === "select" ? selectValues(thought).map((option) => option.value) : ["medium"],
  );
  const supported = [...wireValues.keys()];
  const currentEffort =
    thought && thought.type === "select" ? (normalizeEffort(thought.currentValue) ?? "medium") : "medium";
  return {
    defaultReasoningEffort: supported.includes(currentEffort) ? currentEffort : (supported[0] ?? "medium"),
    supportedReasoningEfforts: supported.length > 0 ? supported : ["medium"],
    reasoningEffortWireValues: wireValues.size > 0 ? wireValues : new Map([["medium", "medium"]]),
  };
}

function sessionConfigOptions(response: SessionSetupResponse): SessionConfigOption[] {
  return response.configOptions ?? [];
}

function currentModelFromSessionSetup(response: SessionSetupResponse): string | null {
  if (!isRecord(response.models)) return null;
  return isString(response.models.currentModelId) && response.models.currentModelId.trim()
    ? response.models.currentModelId.trim()
    : null;
}

function availableModels(response: SessionSetupResponse): Array<{
  id: string;
  name: string;
  description: string | null;
  defaultReasoningEffort: string | null;
  supportedReasoningEfforts: string[] | null;
  reasoningEffortWireValues: Map<string, string> | null;
  usesModelReasoningEffort: boolean | null;
}> {
  if (!isRecord(response.models) || !Array.isArray(response.models.availableModels)) return [];
  const seen = new Set<string>();
  return response.models.availableModels.flatMap((value) => {
    if (!isRecord(value) || !isString(value.modelId) || !value.modelId.trim()) return [];
    const id = value.modelId.trim();
    if (seen.has(id)) return [];
    seen.add(id);
    const metadata = isRecord(value._meta) ? value._meta : null;
    const reasoningEffortValues = Array.isArray(metadata?.reasoningEfforts)
      ? metadata.reasoningEfforts.filter(isRecord).flatMap((effort) => (isString(effort.value) ? [effort.value] : []))
      : null;
    const wireValues = reasoningEffortValues ? reasoningEffortWireValues(reasoningEffortValues) : null;
    const supportedReasoningEfforts = wireValues ? [...wireValues.keys()] : null;
    const usesModelReasoningEffort =
      metadata?.supportsReasoningEffort === false
        ? false
        : metadata?.supportsReasoningEffort === true || (supportedReasoningEfforts?.length ?? 0) > 0
          ? true
          : null;
    return [
      {
        id,
        name: isString(value.name) && value.name.trim() ? value.name.trim() : id,
        description: isString(value.description) && value.description.trim() ? value.description.trim() : null,
        defaultReasoningEffort:
          metadata && isString(metadata.reasoningEffort) ? normalizeEffort(metadata.reasoningEffort) : null,
        supportedReasoningEfforts:
          metadata?.supportsReasoningEffort === false
            ? ["medium"]
            : supportedReasoningEfforts && supportedReasoningEfforts.length > 0
              ? supportedReasoningEfforts
              : null,
        reasoningEffortWireValues: wireValues,
        usesModelReasoningEffort,
      },
    ];
  });
}

function selectValues(option: Extract<SessionConfigOption, { type: "select" }>) {
  return option.options.flatMap((entry) => ("options" in entry ? entry.options : [entry]));
}

function reasoningEffortWireValues(values: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeEffort(value);
    if (normalized && !result.has(normalized)) result.set(normalized, value);
  }
  return result;
}

function normalizeEffort(value: string): string | null {
  const normalized = value.toLowerCase().replaceAll("-", "_");
  if (["low", "medium", "high", "xhigh", "max"].includes(normalized)) return normalized;
  if (["minimal", "none", "off"].includes(normalized)) return "low";
  if (["extra_high", "very_high"].includes(normalized)) return "xhigh";
  return null;
}

async function promptBlocks(params: unknown): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
  for (const item of getArray(params, "input")) {
    if (!isRecord(item)) continue;
    if (item.type === "text" && isString(item.text)) blocks.push({ type: "text", text: item.text });
    if (item.type === "mention" && isString(item.path)) {
      blocks.push({ type: "text", text: `Attached local file: ${item.path}` });
    }
    if (item.type === "localImage" && isString(item.path)) {
      const data = await readFile(item.path);
      blocks.push({ type: "image", data: data.toString("base64"), mimeType: imageMimeType(item.path), uri: item.path });
    }
  }
  return blocks;
}

function imageMimeType(path: string): "image/jpeg" | "image/webp" | "image/png" {
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.webp$/i.test(path)) return "image/webp";
  return "image/png";
}

function requiredString(value: unknown, key: string): string {
  const result = getString(value, key);
  if (!result) throw new Error(`${key} is required.`);
  return result;
}

function printableInput(value: unknown): string | null {
  if (isString(value)) return value;
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function bestPermissionOption(options: PermissionOption[], accepted: boolean): PermissionOption | null {
  const kinds = accepted ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
  return kinds.flatMap((kind) => options.filter((option) => option.kind === kind))[0] ?? null;
}

function elicitationOptions(property: DynamicRecord): Array<{ label: string; description: string }> | null {
  if (Array.isArray(property.oneOf)) {
    return property.oneOf.filter(isRecord).flatMap((option) => {
      const value = getString(option, "const");
      if (!value) return [];
      return [{ label: getString(option, "title") ?? value, description: getString(option, "description") ?? "" }];
    });
  }
  if (Array.isArray(property.enum)) {
    return property.enum.filter(isString).map((value) => ({ label: value, description: "" }));
  }
  if (property.type === "boolean") {
    return [
      { label: "Yes", description: "" },
      { label: "No", description: "" },
    ];
  }
  return null;
}

function elicitationValue(property: DynamicRecord | undefined, answers: string[]): ElicitationContentValue {
  if (!property) return answers[0] ?? "";
  if (property.type === "array") return answers;
  if (property.type === "boolean") return /^(yes|true|1)$/i.test(answers[0] ?? "");
  if (property.type === "number" || property.type === "integer") {
    const parsed = Number(answers[0]);
    return Number.isFinite(parsed) ? parsed : (answers[0] ?? "");
  }
  return answers[0] ?? "";
}

function isDynamicToolResult(value: unknown): value is DynamicToolResult {
  return (
    isRecord(value) &&
    isBoolean(value.success) &&
    Array.isArray(value.contentItems) &&
    value.contentItems.every(
      (item) =>
        isRecord(item) &&
        ((item.type === "inputText" && isString(item.text)) || (item.type === "inputImage" && isString(item.imageUrl))),
    )
  );
}

function isAuthenticationError(error: unknown): boolean {
  return /auth|login|credential|token|unauthori[sz]ed|api key/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
