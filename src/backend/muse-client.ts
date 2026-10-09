import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import {
  type Connection,
  type SendUserTurnOptions,
  type SpawnedMspConnection,
  spawnMspConnection,
} from "@muse-code/sdk";
import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { Effect, Exit, Schema, Scope } from "effect";
import { secretElicitationField } from "./agent/prompts";
import { type AgentClient, type AgentProvider, type DiagnosticOrigin, RequestTimeoutError } from "./agent-client";
import { type AgentCliInfo, cliSpawnTarget } from "./cli";
import { runCauseEffect } from "./effect-boundary";
import { type DynamicToolNamespace, LocalMcpBridge, type LocalMcpSession } from "./local-mcp-bridge";
import {
  acpMcpServers,
  agentMcpServers,
  computerUseParam,
  type McpAuthorizationSource,
  type McpDropReporter,
  type McpServerSource,
  type McpToolRuntimeSource,
  usableMcpServers,
} from "./mcp-provider-shapes";
import { mcpSecretValues, redactMcpValues } from "./mcp-redaction";
import {
  MuseApproval,
  MuseItem,
  MuseModels,
  MusePage,
  MuseSession,
  MuseTerminal,
  MuseUsage,
  MuseUserInput,
  museThreadItem,
} from "./muse-protocol";
import { PendingServerRequests } from "./pending-server-requests";
import type { SpawnTarget } from "./process-confinement";
import {
  type AppServerNotification,
  type AppServerRequest,
  type DynamicToolResult,
  getArray,
  getString,
  isRecord,
  type RequestId,
  type ResponseDecoder,
  type RpcError,
  type ThreadItem,
} from "./protocol";
import {
  type ProviderClientOperationError,
  providerCall,
  providerFailure,
  providerSync,
  requiredString,
  toProviderClientOperationError,
} from "./provider-client-effects";
import type { ReadProviderHistory } from "./provider-history";
import { createDiagnosticStream } from "./stderr-diagnostics";

export interface MuseProviderOptions {
  requestTimeoutMs?: number;
  apiKey(): string | null;
  env?: NodeJS.ProcessEnv;
  extraEnv?: () => Record<string, string>;
  confine?(target: SpawnTarget): SpawnTarget;
  mcpServers?: McpServerSource;
  reportMcpDrops?: McpDropReporter;
  mcpToolRuntimes?: McpToolRuntimeSource;
  mcpAuthorization?: McpAuthorizationSource;
  readAccount?: () => Effect.Effect<
    { authenticated: boolean; email?: string | null; planType?: string | null },
    ProviderClientOperationError
  >;
  profileGeneration?: boolean;
  /** Test seam at the owned SDK process boundary. */
  spawn?: typeof spawnMspConnection;
}

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
  exit: [error: Error];
}
interface MuseTurn {
  id: string;
  compact: boolean;
  items: Map<string, MuseItem>;
  /** Holds a trailing credential prefix until the next delta or authoritative item. */
  deltaPending: Map<string, string>;
}
interface MuseThread {
  id: string;
  cwd: string;
  instructions: string;
  roots: string[];
  mcp: LocalMcpSession;
  turn: MuseTurn | null;
  approvals: Map<string, AbortController>;
  /** Only cursors replayed by a gap fill; remove the live twin when it arrives. */
  replayed: Set<string>;
}

/** Owns one native MSP process, session MCP bridges, and the live view-to-OpenBot event adapter. */
export class MuseAgentClient extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider: AgentProvider = "muse";
  readonly #cli: AgentCliInfo;
  readonly #options: MuseProviderOptions;
  readonly #bridge = new LocalMcpBridge();
  readonly #requests = new PendingServerRequests((request) => this.emit("request", request));
  readonly #threads = new Map<string, MuseThread>();
  readonly #children = new Map<string, MuseAgentClient>();
  readonly #secrets = new Set<string>();
  readonly #diagnostics = createDiagnosticStream({
    redact: (value) => this.#redact(value),
    emit: (message) => this.emit("diagnostic", message, { duringStop: this.#stopping }),
  });
  readonly #scope = Scope.makeUnsafe();
  #running = false;
  #host: SpawnedMspConnection | null = null;
  #starting: Promise<SpawnedMspConnection> | null = null;
  #handshake: ReturnType<typeof spawnMspConnection> | null = null;
  #events: Promise<void> = Promise.resolve();
  #stopping = false;
  #reportedUnknownAuth = false;

  constructor(cli: AgentCliInfo, options: MuseProviderOptions) {
    super();
    this.#cli = cli;
    this.#options = options;
  }
  get running(): boolean {
    return this.#running;
  }
  start(): void {
    this.#running = true;
  }
  canReleaseProcess = (): boolean =>
    [...this.#threads.values()].every((thread) => !thread.turn) &&
    [...this.#children.values()].every((child) => child.canReleaseProcess());
  notify(): void {
    /* The SDK completes the initialized handshake. */
  }
  respond(id: RequestId, result: unknown): void {
    this.#requests.resolve(id, result);
    for (const child of this.#children.values()) child.respond(id, result);
  }
  respondError(id: RequestId, error: RpcError): void {
    this.#requests.reject(id, error);
    for (const child of this.#children.values()) child.respondError(id, error);
  }

  readonly stop = Effect.fn("MuseAgentClient.stop")(function* (
    this: MuseAgentClient,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    this.#stopping = true;
    this.#running = false;
    this.#requests.rejectAll("Muse stopped.");
    for (const child of this.#children.values()) yield* child.stop();
    this.#children.clear();
    for (const thread of this.#threads.values()) {
      for (const controller of thread.approvals.values()) controller.abort();
      thread.mcp.close();
    }
    yield* providerCall(() => this.#handshake?.close());
    this.#diagnostics.flush();
    yield* providerCall(() => this.#events);
    yield* Scope.close(this.#scope, Exit.void);
    yield* this.#bridge.close().pipe(toProviderClientOperationError);
    this.#threads.clear();
    this.#host = null;
  });

  readonly releaseThread = Effect.fn("MuseAgentClient.releaseThread")(function* (this: MuseAgentClient, id: string) {
    const child = this.#children.get(id);
    if (child) {
      if (!child.canReleaseProcess()) return yield* providerFailure(new Error(sourceText("error.provider.museBusy")));
      yield* child.stop();
      this.#children.delete(id);
      return;
    }
    const thread = this.#threads.get(id);
    if (!thread) return;
    if (thread.turn) return yield* providerFailure(new Error(sourceText("error.provider.museBusy")));
    yield* this.#read("view/unsubscribe", { sessionId: id });
    thread.mcp.close();
    this.#threads.delete(id);
  });

  readonly request = Effect.fn("MuseAgentClient.request")(function* <T>(
    this: MuseAgentClient,
    method: string,
    params: unknown,
    decoder: ResponseDecoder<T>,
    timeoutMs?: number,
  ): Effect.fn.Return<T, ProviderClientOperationError> {
    if (!this.#running) return yield* providerFailure(new Error(sourceText("error.provider.museStopped")));
    const response = yield* this.#dispatch(method, params).pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs ?? this.#options.requestTimeoutMs ?? 30_000,
        orElse: () => Effect.fail(providerFailure(new RequestTimeoutError("Muse", method))),
      }),
    );
    return yield* providerSync(() => decoder(response));
  });

  readonly #dispatch = Effect.fn("MuseAgentClient.dispatch")(function* (
    this: MuseAgentClient,
    method: string,
    params: unknown,
  ): Effect.fn.Return<unknown, ProviderClientOperationError> {
    const child = this.#children.get(getString(params, "threadId") ?? "");
    if (child && method !== "thread/resume") return yield* child.#dispatch(method, params);
    switch (method) {
      case "initialize":
        yield* this.#ensureHost();
        return {};
      case "account/read": {
        if (!this.#options.readAccount && !this.#reportedUnknownAuth) {
          this.#reportedUnknownAuth = true;
          this.emit(
            "diagnostic",
            "Muse authentication is not verified. The first model request will check the configured credentials.",
          );
        }
        const status = this.#options.readAccount ? yield* this.#options.readAccount() : { authenticated: true };
        return {
          account: status.authenticated
            ? {
                type: this.#options.readAccount ? "muse" : "muse-unverified",
                email: status.email ?? null,
                planType: status.planType ?? null,
              }
            : null,
          requiresOpenaiAuth: false,
        };
      }
      case "account/rateLimits/read":
        return { rateLimits: null, rateLimitsByLimitId: null };
      case "plugin/list":
        return { marketplaces: [] };
      case "model/list": {
        const catalog = yield* this.#read("model/list", {}).pipe(
          Effect.flatMap((value) => this.#decode(MuseModels, value)),
        );
        if (catalog.providerId !== "meta")
          return yield* providerFailure(new Error(sourceText("error.provider.museUnexpectedProvider")));
        return {
          data: catalog.models
            .filter((row) => row.providerId === "meta")
            .map((row) => ({
              model: row.modelId,
              displayName: row.displayLabel,
              defaultReasoningEffort: row.defaultReasoningEffort ?? "high",
              supportedReasoningEfforts: (Array.isArray(row.variants)
                ? row.variants
                : ["low", "medium", "high", "xhigh", "max"]
              ).map((reasoningEffort) => ({ reasoningEffort })),
            })),
        };
      }
      case "thread/start":
        return yield* this.#openOwnedThread(params, false);
      case "thread/resume":
        return child ? { thread: { id: getString(params, "threadId") } } : yield* this.#openOwnedThread(params, true);
      case "thread/read": {
        const id = yield* providerSync(() => requiredString(params, "threadId"));
        const turns: Array<{ id: string; status?: string; items: ThreadItem[] }> = [];
        if (isRecord(params) && params.includeTurns === true)
          yield* this.readHistory({ threadId: id, items: "full" }, (fragment) =>
            Effect.sync(() => {
              turns.unshift({
                id: fragment.turnId,
                ...(fragment.status ? { status: fragment.status } : {}),
                items: fragment.items,
              });
              return true;
            }),
          );
        return { thread: { id, turns } };
      }
      case "turn/start":
        return yield* this.#startTurn(params, false);
      case "thread/compact/start":
        return yield* this.#startTurn(params, true);
      case "turn/interrupt": {
        const thread = yield* this.#thread(params);
        if (thread.turn) yield* this.#command("turn/interrupt", { sessionId: thread.id, turnId: thread.turn.id });
        return {};
      }
      case "turn/steer": {
        const thread = yield* this.#thread(params);
        if (!thread.turn) return yield* providerFailure(new Error(sourceText("error.provider.museNoActiveTurn")));
        yield* this.#command("turn/steer", {
          sessionId: thread.id,
          expectedTurnId: thread.turn.id,
          input: yield* musePrompt(params),
        });
        return { turn: { id: thread.turn.id, status: "inProgress" }, turnId: thread.turn.id };
      }
      default:
        return yield* providerFailure(new Error(sourceText("error.provider.museMethodUnsupported", { method })));
    }
  });

  readonly #decode = <A, I>(schema: Schema.Codec<A, I>, value: unknown) =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError(() => providerFailure(new Error(sourceText("error.provider.museInvalidProtocol")))),
    );

  readonly #ensureHost = Effect.fn("MuseAgentClient.ensureHost")(function* (this: MuseAgentClient) {
    if (this.#options.profileGeneration)
      return yield* providerFailure(new Error(sourceText("error.provider.museProfileUnsupported")));
    if (this.#host) return this.#host;
    if (!this.#starting) this.#starting = this.#launch();
    return yield* providerCall(() => this.#starting).pipe(
      Effect.flatMap((host) =>
        host
          ? Effect.succeed(host)
          : Effect.fail(providerFailure(new Error(sourceText("error.provider.museNotStarted")))),
      ),
    );
  });

  async #launch(): Promise<SpawnedMspConnection> {
    const base = cliSpawnTarget(
      this.#cli.executable,
      this.#options.profileGeneration
        ? ["serve", "--disable-shell", "--disable-write", "-c", "hooks={}", "-c", "managed_hooks_path=null"]
        : ["serve", "--trust-workspace", "--disable-sandbox"],
    );
    const target = this.#options.confine?.(base) ?? base;
    if (target.windowsVerbatimArguments) throw new Error(sourceText("error.provider.museNativeWindows"));
    const environment: NodeJS.ProcessEnv = {
      ...(this.#options.env ?? process.env),
      ...this.#options.extraEnv?.(),
      MUSE_NO_AUTO_UPDATE: "1",
    };
    for (const key of Object.keys(environment)) if (key.toUpperCase() === "META_API_KEY") delete environment[key];
    const apiKey = this.#options.apiKey();
    if (apiKey) {
      environment.META_API_KEY = apiKey;
      this.#secrets.add(apiKey);
    }
    const handshake = (this.#options.spawn ?? spawnMspConnection)({
      command: target.command,
      args: target.args,
      env: environment,
      shutdownTimeoutMs: 10_000,
      onStderr: (chunk) => this.#diagnostics.push(chunk),
    });
    this.#handshake = handshake;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const host = await Promise.race([
        handshake.initialize({
          clientInfo: { name: "openbot", version: "1" },
          capabilities: { requestedCapabilities: ["sessionMcp"] },
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(sourceText("error.provider.museStartTimeout"))),
            this.#options.requestTimeoutMs ?? 30_000,
          );
        }),
      ]);
      if (this.#stopping) throw new Error(sourceText("error.provider.museStartStopped"));
      if (host.initializeResult.schema.version !== 1) throw new Error(sourceText("error.provider.museProtocolVersion"));
      if (host.initializeResult.sessionDurability === "ephemeral")
        throw new Error(sourceText("error.provider.museHistoryRequired"));
      this.#host = host;
      host.connection.onServerRequest(async (request) => {
        if (request.method === "approval/request" || request.method === "userInput/request") return {};
        throw new Error(sourceText("error.provider.museRequestUnsupported"));
      });
      host.connection.onNotification((notification) => {
        this.#events = this.#events
          .then(() =>
            this.#stopping || !this.#running
              ? undefined
              : runCauseEffect(this.#notification(notification.method, notification.params)),
          )
          .catch((error) => this.#fail(error));
      });
      host.connection.onProtocolError(() => this.#fail(new Error("Muse protocol failed.")));
      void host.connection.closed.then(() => {
        if (!this.#stopping) this.#fail(new Error("Muse connection closed."));
      });
      return host;
    } catch (error) {
      await handshake.close();
      this.#starting = null;
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  #redactionValues(): string[] {
    const key = this.#options.apiKey();
    if (key) this.#secrets.add(key);
    const secrets = [...this.#secrets, ...mcpSecretValues(this.#options.mcpServers?.() ?? [])];
    return secrets
      .flatMap((secret) => [secret, JSON.stringify(secret).slice(1, -1)])
      .filter((secret) => secret.length >= 4);
  }

  #redact(value: string): string {
    return redactMcpValues(redactText(value), this.#redactionValues());
  }
  #fail(_error: unknown): void {
    if (!this.#running) return;
    this.#running = false;
    this.#requests.rejectAll("Muse connection failed.");
    this.emit("exit", new Error(sourceText("error.provider.museConnectionFailed")));
  }
  readonly #read = Effect.fn("MuseAgentClient.read")(function* (
    this: MuseAgentClient,
    method: string,
    params: Parameters<Connection["command"]>[1],
  ) {
    const host = yield* this.#ensureHost();
    return yield* providerCall(() => host.connection.request(method, params)).pipe(
      Effect.timeoutOrElse({
        duration: this.#options.requestTimeoutMs ?? 30_000,
        orElse: () => Effect.fail(providerFailure(new RequestTimeoutError("Muse", method))),
      }),
    );
  });
  readonly #command = Effect.fn("MuseAgentClient.command")(function* (
    this: MuseAgentClient,
    method: string,
    params: Parameters<Connection["command"]>[1],
    commandId?: string,
  ) {
    const host = yield* this.#ensureHost();
    return yield* providerCall(() =>
      host.connection.command(method, params, { maxAttempts: 1, ...(commandId ? { commandId } : {}) }),
    );
  });
  readonly #thread = Effect.fn("MuseAgentClient.thread")(function* (this: MuseAgentClient, params: unknown) {
    const id = yield* providerSync(() => requiredString(params, "threadId"));
    const thread = this.#threads.get(id);
    if (!thread) return yield* providerFailure(new Error(sourceText("error.provider.museUnknownSession")));
    return thread;
  });

  readonly #openThread = Effect.fn("MuseAgentClient.openThread")(function* (
    this: MuseAgentClient,
    params: unknown,
    resume: boolean,
  ): Effect.fn.Return<{ thread: { id: string } }, ProviderClientOperationError> {
    const host = yield* this.#ensureHost();
    const id = resume ? yield* providerSync(() => requiredString(params, "threadId")) : host.connection.mintCommandId();
    if (this.#threads.has(id)) return { thread: { id } };
    const cwd = yield* providerSync(() => requiredString(params, "cwd"));
    const tools = this.#options.profileGeneration ? [] : getArray(params, "dynamicTools").filter(isNamespace);
    const bridge = yield* this.#bridge
      .createSession(
        id,
        tools,
        () => this.#threads.get(id)?.turn?.id ?? null,
        (call, signal) =>
          this.#requests
            .call("item/tool/call", call, signal)
            .pipe(
              Effect.flatMap((value) =>
                isToolResult(value)
                  ? Effect.succeed(value)
                  : Effect.fail(providerFailure(new Error(sourceText("error.provider.museInvalidToolResult")))),
              ),
            ),
      )
      .pipe(toProviderClientOperationError);
    const setup = Effect.gen({ self: this }, function* () {
      const resolved = yield* usableMcpServers(
        agentMcpServers(
          this.#options.profileGeneration ? [] : (this.#options.mcpServers?.() ?? []),
          computerUseParam(params),
        ),
        this.#options.mcpToolRuntimes?.(),
        this.#options.mcpAuthorization,
      ).pipe(toProviderClientOperationError);
      for (const secret of mcpSecretValues(resolved.map((server) => server.config))) this.#secrets.add(secret);
      const handoff = acpMcpServers(resolved);
      for (const server of [...handoff.servers, ...bridge.servers]) {
        for (const entry of "headers" in server ? server.headers : server.env) this.#secrets.add(entry.value);
      }
      this.#options.reportMcpDrops?.(this.provider, handoff.dropped);
      const mcpServers = Object.fromEntries(
        [...handoff.servers, ...bridge.servers].map((server) => [
          server.name,
          "url" in server
            ? {
                transport: "streamableHttp",
                url: server.url,
                headers: Object.fromEntries(server.headers.map((header) => [header.name, header.value])),
              }
            : {
                transport: "stdio",
                command: server.command,
                args: server.args,
                env: Object.fromEntries(server.env.map((entry) => [entry.name, entry.value])),
              },
        ]),
      );
      if (Object.keys(mcpServers).length && !host.initializeResult.grantedCapabilities.includes("sessionMcp"))
        return yield* providerFailure(new Error(sourceText("error.provider.museMcpRequired")));
      const thread: MuseThread = {
        id,
        cwd,
        instructions: getString(params, "developerInstructions") ?? "",
        roots: getArray(params, "runtimeWorkspaceRoots").filter(isString),
        mcp: bridge,
        turn: null,
        approvals: new Map(),
        replayed: new Set(),
      };
      this.#threads.set(id, thread);
      const model = getString(params, "model");
      const response = yield* this.#command(resume ? "session/resume" : "session/start", {
        sessionId: id,
        config: { mcpServers },
        ...(resume
          ? { excludeItems: true }
          : {
              workspaceRoot: cwd,
              providerId: "meta",
              approvalMode: "promptUnmatched",
              ...(model && model !== "default" ? { modelId: model } : {}),
            }),
      }).pipe(Effect.flatMap((value) => this.#decode(MuseSession, value)));
      if (response.session.sessionId !== id)
        return yield* providerFailure(new Error(sourceText("error.provider.museSessionMismatch")));
      return { thread: { id } };
    });
    return yield* setup.pipe(
      Effect.onError(() =>
        Effect.sync(() => {
          bridge.close();
          this.#threads.delete(id);
        }),
      ),
    );
  });

  /** MSP has no session-close command. A session owns its process so MCP refresh can stop it. */
  readonly #openOwnedThread = Effect.fn("MuseAgentClient.openOwnedThread")(function* (
    this: MuseAgentClient,
    params: unknown,
    resume: boolean,
  ) {
    const child = new MuseAgentClient(this.#cli, this.#options);
    child.on("notification", (event) => this.emit("notification", event));
    child.on("request", (event) => this.emit("request", event));
    child.on("diagnostic", (message, origin) => this.emit("diagnostic", message, origin));
    child.once("exit", (error) => this.#fail(error));
    child.start();
    const response = yield* child
      .#openThread(params, resume)
      .pipe(Effect.onError(() => child.stop().pipe(Effect.ignore)));
    this.#children.set(response.thread.id, child);
    return response;
  });

  readonly #startTurn = Effect.fn("MuseAgentClient.startTurn")(function* (
    this: MuseAgentClient,
    params: unknown,
    compact: boolean,
  ) {
    const thread = yield* this.#thread(params);
    if (thread.turn) return yield* providerFailure(new Error(sourceText("error.provider.museBusy")));
    const host = yield* this.#ensureHost();
    const model = getString(params, "model");
    if (model && model !== "default")
      yield* this.#command("session/setModel", { sessionId: thread.id, model: { modelId: model, providerId: "meta" } });
    const input = compact ? [] : yield* musePrompt(params);
    if (thread.instructions) input.unshift({ type: "text", text: thread.instructions });
    const id = host.connection.mintCommandId();
    thread.turn = { id, compact, items: new Map(), deltaPending: new Map() };
    this.#emit("turn/started", { threadId: thread.id, turn: { id, status: "inProgress" } });
    const effort = getString(params, "effort");
    const result = yield* this.#command(
      compact ? "session/compact" : "turn/start",
      {
        sessionId: thread.id,
        ...(compact
          ? {}
          : {
              input,
              workspaceRoots: [thread.cwd, ...thread.roots],
              ifBusy: "queue",
              ...(effort ? { reasoningEffort: effort } : {}),
            }),
      },
      id,
    ).pipe(
      Effect.onError(() =>
        Effect.sync(() => {
          thread.turn = null;
        }),
      ),
    );
    if (compact) {
      if (getString(result, "status") !== "accepted") {
        this.#finish(thread, "failed");
        return yield* providerFailure(new Error(sourceText("error.provider.museCompactRejected")));
      }
    } else if (getString(result, "turnId") !== id) {
      this.#fail(new Error(sourceText("error.provider.museTurnMismatch")));
      return yield* providerFailure(new Error(sourceText("error.provider.museTurnMismatch")));
    }
    return { turn: { id, status: "inProgress" } };
  });

  /** Only provider text is redacted. IDs, status, revisions, and numeric usage stay intact. */
  #publicItem(item: MuseItem, turn?: MuseTurn): ThreadItem {
    const redact = (text: string, field: string): string => {
      if (!turn || item.status !== "inProgress") return this.#redact(text);
      turn.deltaPending.delete(`${item.itemId}:${field}`);
      return this.#streamDelta(turn, item.itemId, field, text);
    };
    return museThreadItem({
      ...item,
      tool: this.#redact(item.tool ?? item.kind),
      ...(item.text !== undefined ? { text: redact(item.text, "text") } : {}),
      ...(item.summary !== undefined
        ? { summary: item.summary.map((text, index) => redact(text, `summary.${index}`)) }
        : {}),
      ...(item.args !== undefined ? { args: redact(item.args, "args") } : {}),
      ...(item.visibleOutput !== undefined ? { visibleOutput: redact(item.visibleOutput, "output") } : {}),
      ...(item.commandText !== undefined ? { commandText: redact(item.commandText, "commandText") } : {}),
      ...(item.failureReason !== undefined ? { failureReason: redact(item.failureReason, "failureReason") } : {}),
    });
  }

  #streamDelta(turn: MuseTurn, itemId: string, field: string, delta: string): string {
    const key = `${itemId}:${field}`;
    const text = this.#redact((turn.deltaPending.get(key) ?? "") + delta);
    let held = 0;
    for (const secret of this.#redactionValues()) {
      for (let length = Math.min(secret.length - 1, text.length); length > held; length--) {
        if (secret.startsWith(text.slice(-length))) {
          held = length;
          break;
        }
      }
    }
    if (held) turn.deltaPending.set(key, text.slice(-held));
    else turn.deltaPending.delete(key);
    return text.slice(0, text.length - held);
  }

  #emit(method: string, params: unknown): void {
    this.emit("notification", { method, params });
  }
  #publish(thread: MuseThread, item: MuseItem): void {
    const turn = thread.turn;
    if (!turn || (item.turnId && item.turnId !== turn.id && !turn.compact)) return;
    const old = turn.items.get(item.itemId);
    if (old && old.revision >= item.revision) return;
    turn.items.set(item.itemId, item);
    if (item.status !== "inProgress") {
      // The final item replaces streamed text, including any held ordinary suffix.
      for (const key of turn.deltaPending.keys()) if (key.startsWith(`${item.itemId}:`)) turn.deltaPending.delete(key);
    }
    this.#emit(item.status === "inProgress" ? "item/started" : "item/completed", {
      threadId: thread.id,
      turnId: turn.id,
      item: this.#publicItem(item, turn),
    });
  }
  #finish(thread: MuseThread, status: string): void {
    const turn = thread.turn;
    if (!turn) return;
    thread.turn = null;
    for (const controller of thread.approvals.values()) controller.abort();
    thread.approvals.clear();
    this.#emit("turn/completed", { threadId: thread.id, turn: { id: turn.id, status } });
  }

  readonly #notification = Effect.fn("MuseAgentClient.notification")(function* (
    this: MuseAgentClient,
    method: string,
    params: unknown,
    replay = false,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    const id = getString(params, "sessionId");
    const thread = id ? this.#threads.get(id) : undefined;
    if (!thread) return;
    const cursor = getString(params, "viewCursor");
    if (!replay && cursor && thread.replayed.delete(cursor)) return;
    if (method === "view/gap") {
      let after = yield* providerSync(() => requiredString(params, "after"));
      const next = yield* providerSync(() => requiredString(params, "next"));
      const visited = new Set<string>();
      while (!visited.has(after)) {
        visited.add(after);
        const page = yield* this.#read("view/page", {
          sessionId: thread.id,
          cursor: after,
          direction: "forward",
          limit: 100,
        }).pipe(Effect.flatMap((value) => this.#decode(MusePage, value)));
        for (const event of page.events) {
          const eventCursor = getString(event.params, "viewCursor");
          if (eventCursor === next) return;
          if (getString(event.params, "sessionId") !== thread.id)
            return yield* providerFailure(new Error(sourceText("error.provider.museHistoryMismatch")));
          yield* this.#notification(event.method, event.params, true);
          if (eventCursor) thread.replayed.add(eventCursor);
        }
        if (!page.nextCursor) return yield* providerFailure(new Error(sourceText("error.provider.museRecoveryFailed")));
        after = page.nextCursor;
      }
      return yield* providerFailure(new Error(sourceText("error.provider.museHistoryStalled")));
    }
    if (method === "approval/requested" || method === "approval/updated") {
      const approval = yield* this.#decode(MuseApproval, params);
      const key = `${approval.approvalId}:${approval.currentRequirementId.sourceIndex}`;
      if (thread.approvals.has(key)) return;
      for (const [previous, controller] of thread.approvals) {
        if (previous.startsWith(`${approval.approvalId}:`)) {
          controller.abort();
          thread.approvals.delete(previous);
        }
      }
      const controller = new AbortController();
      thread.approvals.set(key, controller);
      yield* Effect.forkIn(
        this.#approve(thread, approval, controller.signal).pipe(
          Effect.catch(() =>
            Effect.sync(() => {
              if (!controller.signal.aborted) this.#fail(new Error("Muse approval failed."));
            }),
          ),
        ),
        this.#scope,
        { startImmediately: true },
      );
      return;
    }
    if (method === "approval/resolved") {
      const approvalId = getString(params, "approvalId");
      for (const [key, controller] of thread.approvals)
        if (key.startsWith(`${approvalId}:`)) {
          controller.abort();
          thread.approvals.delete(key);
        }
      return;
    }
    if (method === "userInput/requested") {
      const input = yield* this.#decode(MuseUserInput, params);
      const key = `input:${input.userInputId}`;
      if (thread.approvals.has(key)) return;
      const controller = new AbortController();
      thread.approvals.set(key, controller);
      yield* Effect.forkIn(
        this.#answer(thread, input, controller.signal).pipe(
          Effect.catch(() =>
            Effect.sync(() => {
              if (!controller.signal.aborted) this.#fail(new Error("Muse user input failed."));
            }),
          ),
        ),
        this.#scope,
        { startImmediately: true },
      );
      return;
    }
    if (method === "userInput/settled") {
      const key = `input:${getString(params, "userInputId")}`;
      thread.approvals.get(key)?.abort();
      thread.approvals.delete(key);
      return;
    }
    if (method === "item/started" || method === "item/updated" || method === "item/completed") {
      const event = yield* this.#decode(Schema.Struct({ item: MuseItem }), params);
      this.#publish(thread, event.item);
      if (thread.turn?.compact && event.item.kind === "compaction" && event.item.status !== "inProgress")
        this.#finish(
          thread,
          event.item.status === "completed" && event.item.outcome !== "noop" ? "completed" : "failed",
        );
      return;
    }
    if (method === "item/delta" && thread.turn) {
      const itemId = getString(params, "itemId");
      const delta = getString(params, "delta");
      const item = itemId ? thread.turn.items.get(itemId) : undefined;
      if (!item || delta === null) return;
      const field = getString(params, "field") ?? "text";
      const event =
        item.kind === "agentMessage" && field === "text"
          ? "item/agentMessage/delta"
          : item.kind === "reasoning"
            ? "item/reasoning/summaryTextDelta"
            : "item/commandExecution/outputDelta";
      const safeDelta = this.#streamDelta(
        thread.turn,
        item.itemId,
        field === "visibleOutput" ? "output" : field,
        delta,
      );
      if (safeDelta)
        this.#emit(event, { threadId: thread.id, turnId: thread.turn.id, itemId, delta: safeDelta, summaryIndex: 0 });
      return;
    }
    if (method === "session/tokenUsage") {
      const usage = yield* this.#decode(MuseUsage, params);
      this.#emit("openbot/usage", {
        threadId: thread.id,
        turnId: usage.turnId,
        usage: {
          inputTokens: usage.cumulative.promptTokens,
          outputTokens: usage.cumulative.outputTokens,
          cachedReadTokens: usage.cumulative.cacheReadTokens ?? 0,
          cachedWriteTokens: usage.cumulative.cacheWriteTokens ?? 0,
        },
      });
      return;
    }
    if (method === "turn/completed" && thread.turn && !thread.turn.compact) {
      const terminal = yield* this.#decode(MuseTerminal, params);
      if (terminal.turnId !== thread.turn.id) return;
      // A terminal can follow dropped ephemeral deltas. Read final durable items before publishing it.
      const history = yield* this.#history(thread.id);
      for (const item of history) this.#publish(thread, item);
      if (terminal.terminal === "failed") {
        this.#emit("error", {
          threadId: thread.id,
          turnId: terminal.turnId,
          error: {
            message: this.#redact(
              terminal.error?.message ?? terminal.reason ?? sourceText("error.provider.museTurnFailed"),
            ),
          },
          willRetry: false,
        });
      }
      this.#finish(
        thread,
        terminal.terminal === "completed" ? "completed" : terminal.terminal === "cancelled" ? "interrupted" : "failed",
      );
    }
  });

  readonly #approve = Effect.fn("MuseAgentClient.approve")(function* (
    this: MuseAgentClient,
    thread: MuseThread,
    approval: typeof MuseApproval.Type,
    signal: AbortSignal,
  ) {
    const response = this.#options.profileGeneration
      ? { decision: "decline" }
      : yield* this.#requests.call(
          "item/commandExecution/requestApproval",
          {
            threadId: thread.id,
            turnId: thread.turn?.id,
            command: approval.subject.command ?? null,
            reason: approval.subject.path ?? approval.subject.kind,
          },
          signal,
        );
    const accept = getString(response, "decision") === "accept" || getString(response, "decision") === "approved";
    const choices = approval.availableChoices;
    const choice = accept
      ? choices.find((candidate) => candidate.decision === "approved" && candidate.scope === "once")
      : (choices.find((candidate) => candidate.decision === "denied") ??
        choices.find((candidate) => candidate.decision === "abort"));
    if (!choice) return yield* providerFailure(new Error(sourceText("error.provider.museApprovalUnavailable")));
    yield* this.#command("approval/decide", {
      sessionId: thread.id,
      approvalId: approval.approvalId,
      requirementId: approval.currentRequirementId,
      choiceId: choice.choiceId,
    });
  });

  readonly #answer = Effect.fn("MuseAgentClient.answer")(function* (
    this: MuseAgentClient,
    thread: MuseThread,
    input: typeof MuseUserInput.Type,
    signal: AbortSignal,
  ) {
    const result = yield* this.#requests.call(
      "item/tool/requestUserInput",
      {
        threadId: thread.id,
        turnId: thread.turn?.id,
        questions: input.questions.map((question) => ({
          ...question,
          isOther: true,
          isSecret: secretElicitationField(`${question.id} ${question.header} ${question.question}`, undefined),
        })),
      },
      signal,
    );
    const raw = isRecord(result) && isRecord(result.answers) ? result.answers : {};
    const answers = input.questions.map((question) => {
      const values = getArray(raw[question.id], "answers").filter(isString);
      const selected = values.filter((value) => question.options.some((option) => option.label === value));
      const freeText = values.filter((value) => !selected.includes(value)).join("\n");
      return {
        questionId: question.id,
        ...(selected.length
          ? question.selection.mode === "single"
            ? { selectedLabel: selected[0] }
            : { selectedLabels: selected }
          : {}),
        ...(freeText ? (selected.length ? { note: freeText } : { freeText }) : {}),
      };
    });
    yield* this.#command("userInput/answer", { sessionId: thread.id, userInputId: input.userInputId, answers });
  });

  readonly #history = Effect.fn("MuseAgentClient.history")(function* (
    this: MuseAgentClient,
    id: string,
    terminals?: Map<string, string>,
  ): Effect.fn.Return<readonly MuseItem[], ProviderClientOperationError> {
    const result = yield* this.#read("session/read", { sessionId: id, excludeItems: false }).pipe(
      Effect.flatMap((value) => this.#decode(MuseSession, value)),
    );
    if (result.session.sessionId !== id)
      return yield* providerFailure(new Error(sourceText("error.provider.museHistoryOwner")));
    const history = result.history;
    if (!history) return yield* providerFailure(new Error(sourceText("error.provider.museHistoryMissing")));
    if (!terminals && history.items) return history.items;
    if (!terminals && history.snapshot?.schemaVersion === 1 && history.mode === "snapshot")
      return history.snapshot.state.items;
    // Paged mode and a partial compaction snapshot need the full durable view.
    const items = new Map<string, MuseItem>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const page: typeof MusePage.Type = yield* this.#read("view/page", {
        sessionId: id,
        limit: 100,
        direction: "forward",
        ...(cursor ? { cursor } : {}),
      }).pipe(Effect.flatMap((value) => this.#decode(MusePage, value)));
      for (const event of page.events) {
        if (getString(event.params, "sessionId") !== id)
          return yield* providerFailure(new Error(sourceText("error.provider.museHistoryMismatch")));
        if (terminals && event.method === "turn/completed") {
          const terminal = yield* this.#decode(MuseTerminal, event.params);
          terminals.set(
            terminal.turnId,
            terminal.terminal === "completed"
              ? "completed"
              : terminal.terminal === "cancelled"
                ? "interrupted"
                : "failed",
          );
        }
        if (event.method === "item/started" || event.method === "item/updated" || event.method === "item/completed") {
          const value = yield* this.#decode(Schema.Struct({ item: MuseItem }), event.params);
          const previous = items.get(value.item.itemId);
          if (!previous || value.item.revision > previous.revision) items.set(value.item.itemId, value.item);
        }
      }
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor))
        return yield* providerFailure(new Error(sourceText("error.provider.museHistoryStalled")));
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return [...items.values()];
  });

  readonly readHistory: ReadProviderHistory = Effect.fn("MuseAgentClient.readHistory")(function* (
    this: MuseAgentClient,
    request,
    consume,
  ) {
    const child = this.#children.get(request.threadId);
    if (child) return yield* child.readHistory(request, consume);
    const terminals = new Map<string, string>();
    const items = yield* this.#history(request.threadId, terminals);
    const turns = new Map<string, MuseItem[]>();
    for (const item of items) {
      if (!item.turnId) continue;
      const turn = turns.get(item.turnId) ?? [];
      turn.push(item);
      turns.set(item.turnId, turn);
    }
    for (const id of terminals.keys()) if (!turns.has(id)) turns.set(id, []);
    for (const [id, turn] of [...turns].reverse()) {
      const status = terminals.get(id);
      if (
        !(yield* consume({
          turnId: id,
          ...(status ? { status } : {}),
          items: request.items === "full" ? turn.map((item) => this.#publicItem(item)) : [],
          complete: true,
        }))
      )
        break;
    }
  });
}

const musePrompt = Effect.fn("MuseAgentClient.prompt")(function* (params: unknown) {
  const input: SendUserTurnOptions<never>["input"] = [];
  for (const item of getArray(params, "input")) {
    if (!isRecord(item)) continue;
    if (item.type === "text" && isString(item.text)) input.push({ type: "text", text: item.text });
    if (item.type === "mention" && isString(item.path))
      input.push({ type: "text", text: `Attached local file: ${item.path}` });
    if (item.type === "localImage" && isString(item.path)) {
      const path = item.path;
      const bytes = yield* providerCall(() => readFile(path));
      input.push({
        type: "image",
        base64Data: bytes.toString("base64"),
        mediaType: /\.jpe?g$/iu.test(path) ? "image/jpeg" : /\.webp$/iu.test(path) ? "image/webp" : "image/png",
      });
    }
  }
  if (!input.length) return yield* providerFailure(new Error(sourceText("error.provider.museEmptyInput")));
  return input;
});
function isNamespace(value: unknown): value is DynamicToolNamespace {
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
function isToolResult(value: unknown): value is DynamicToolResult {
  return isRecord(value) && typeof value.success === "boolean" && Array.isArray(value.contentItems);
}
