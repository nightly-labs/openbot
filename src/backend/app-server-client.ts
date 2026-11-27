import { type ChildProcess, type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { agentProviderName } from "@openbot/contracts/ipc";
import { type DynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Deferred, Effect, Fiber, Result, Schema } from "effect";
import { isTurnContextBlock } from "./agent/developer-instructions";
import { LOG_TIMESTAMP_PREFIX } from "./agent/provider-diagnostics";
import { TurnContext } from "./agent/turn-context";
import {
  AgentProcessExitError,
  type AgentProvider,
  ProviderSessionBusyError,
  ProviderStoppedError,
  RequestTimeoutError,
} from "./agent-client";
import { cliSpawnTarget } from "./cli";
import { providerCheckTimeoutMs } from "./disk-restore";
import { JsonLineDecoder, LineTooLongError } from "./jsonl";
import {
  type AppServerNotification,
  type AppServerRequest,
  type DeclaredReasoningEfforts,
  declaredReasoningEfforts,
  decodeModelListResponse,
  decodeRecordResponse,
  isRecord,
  type ModelListResponse,
  type RequestId,
  type ResponseDecoder,
  type RpcError,
  type RpcMessage,
  type ThreadItem,
} from "./protocol";
import { ProviderClientOperationError } from "./provider-client-effects";
import {
  PROVIDER_HISTORY_PAGE_SIZE,
  type ProviderHistoryConsumer,
  type ProviderHistoryFragment,
  type ProviderHistoryRequest,
} from "./provider-history";
import { endProcessGroupOnExit, PROVIDER_PROCESS_GROUP } from "./provider-process-group";
import { registerProviderProcess } from "./provider-processes";
import { createDiagnosticStream } from "./stderr-diagnostics";
import { endProcessTree } from "./windows-process-tree";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string];
}

const CRASH_RECORD = /\bpanicked at\b|^(?:\S+\s+)?FATAL\s|^(?:[A-Za-z]*Error|error|fatal)(?: ?\[[^\]]+\])?:\s*\S/u;
const STDERR_END_WAIT_MS = 250;
const WINDOWS_SANDBOX_FAILURE =
  /^(?:execution error|Failed to create unified exec process): .*\b(?:CryptUnprotectData failed|registered Core)\b/su;
const LINUX_SANDBOX_FAILURE =
  /^\s*bwrap: (?:Failed to make \/ slave|setting up uid map|No permissions to creat(?:e a new|ing new) namespace|Creating new namespace failed|pivot_root\b|loopback: Failed RTM_NEW(?:ADDR|LINK))/u;
const CODEX_APP_SANDBOX_ENV = "CODEX_WINDOWS_REGISTERED_CORE";
const LINUX_SANDBOX_PROBE_TIMEOUT_MS = 10_000;
const LINUX_SANDBOX_PROBE_OUTPUT_LIMIT = 64 * 1024;
const decodeBackgroundTerminals = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(Schema.Unknown) }));
const SUBAGENT_OWNER_TOOLS: ReadonlySet<unknown> = new Set(["spawnAgent", "resumeAgent", "sendInput"]);
const CODEX_STOP_GRACE_MS = 10_000;
const ABANDONED_PROCESS_BACKGROUND_HOLD_MS = 10 * 60_000;
const CODEX_TURN_STALL_MS = 15 * 60_000;
const CODEX_TOOL_STALL_MS = 60 * 60_000;
const CODEX_STALL_CHECK_MS = 60_000;
const OUTPUT_ITEM_TYPES: ReadonlySet<unknown> = new Set(["agentMessage", "reasoning", "userMessage", "plan"]);

const logger = createOpenBotLogger("codex-app-server");

interface TurnClock {
  threadId: string;
  turnId: string;
  lastActivityAt: number;
  openItems: Set<string>;
}
const THREAD_WORK_METHODS: ReadonlySet<string> = new Set([
  "thread/start",
  "thread/resume",
  "thread/fork",
  "thread/compact/start",
  "turn/start",
  "turn/steer",
]);

const EFFORT_METHODS: ReadonlySet<string> = new Set(["thread/start", "thread/resume", "turn/start"]);
type DeclaredCatalog = ReadonlyMap<string, DeclaredReasoningEfforts>;

function notificationTurnKey(params: unknown): string | null {
  if (!isRecord(params) || !isString(params.threadId)) return null;
  const turnId = isString(params.turnId) ? params.turnId : isRecord(params.turn) ? params.turn.id : null;
  return isString(turnId) ? JSON.stringify([params.threadId, turnId]) : null;
}

export class AppServerError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "AppServerError";
  }
}

export class CodexAppServerClient extends EventEmitter<ClientEvents> {
  readonly contextCompaction = "events";
  readonly provider: AgentProvider = "codex";
  readonly turnContext = true;
  readonly imageInput = (): boolean => true;
  readonly modelAddressVariable?: string;
  readonly #turnContext: TurnContext;
  readonly #executable: string;
  readonly #requestTimeoutMs: number;
  #decoder = new JsonLineDecoder();
  readonly #pending = new Map<RequestId, PendingRequest>();
  readonly #toolRequests = new Map<RequestId, { threadId: string; turnId: string; controller: AbortController }>();
  readonly #serverRequestIds = new Map<string, RequestId>();
  readonly #interruptedTurns = new Set<string>();
  readonly #openTurns = new Set<string>();
  readonly #liveTurns = new Set<string>();
  readonly #stopWatches = new Map<string, { timer: ReturnType<typeof setTimeout>; requests: RequestId[] }>();
  readonly #abandonedTurns = new Map<string, { threadId: string; at: number }>();
  readonly #subagentParents = new Map<string, string>();
  readonly #stoppedParents = new Set<string>();
  readonly #turnClocks = new Map<string, TurnClock>();
  readonly #hostRequests = new Map<string, { threadId: string; turnKey: string }>();
  #stallCheck: { timer: ReturnType<typeof setInterval>; at: number } | null = null;
  #threadWork = 0;
  readonly #sandboxWarnings = new Map<string, string>();
  #linuxSandboxFailure: Fiber.Fiber<string | null | undefined> | null = null;
  #process: ChildProcessWithoutNullStreams | null = null;
  #ending: Fiber.Fiber<void> | null = null;
  #nextId = 1;
  #stopping = false;
  #probing = false;
  #catalog: DeclaredCatalog | null = null;
  #catalogRead: Deferred.Deferred<ModelListResponse, ProviderClientOperationError> | null = null;

  readonly #extraEnv: Readonly<Record<string, string>> | undefined;
  readonly #configOverrides: readonly string[];

  constructor(
    executable: string,
    requestTimeoutMs = 30_000,
    extraEnv?: Readonly<Record<string, string>>,
    turnContext = new TurnContext(),
    configOverrides: readonly string[] = [],
    modelAddressVariable?: string,
  ) {
    super();
    this.#turnContext = turnContext;
    this.#executable = executable;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#extraEnv = extraEnv;
    this.#configOverrides = configOverrides;
    if (modelAddressVariable) this.modelAddressVariable = modelAddressVariable;
  }

  get running(): boolean {
    return this.#process !== null && this.#process.exitCode === null;
  }

  start(): void {
    if (this.running) return;

    this.#stopping = false;
    this.#linuxSandboxFailure = null;
    this.#decoder = new JsonLineDecoder();
    this.#serverRequestIds.clear();
    this.#catalog = null;
    this.#catalogRead = null;
    const target = cliSpawnTarget(this.#executable, [
      "app-server",
      ...this.#configOverrides.flatMap((override) => ["-c", override]),
      "--listen",
      "stdio://",
    ]);
    const child = spawn(target.command, target.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: codexEnvironment(this.#extraEnv),
      windowsVerbatimArguments: target.windowsVerbatimArguments,
      windowsHide: true,
      detached: PROVIDER_PROCESS_GROUP,
    });
    this.#process = child;
    registerProviderProcess(child, "codex");
    endProcessGroupOnExit(child);

    child.stdin.on("error", (error) => this.#fail(error, child));
    child.stdout.on("data", (chunk: Buffer) => {
      try {
        for (const message of this.#decoder.push(chunk)) this.#handleMessage(message);
      } catch (error) {
        this.#fail(
          error instanceof LineTooLongError ? error : new Error(`Codex protocol error: ${String(error)}`),
          child,
        );
      }
    });

    let lastRecord: string | null = null;
    let lastCrash: string | null = null;
    const diagnostics = createDiagnosticStream({
      redact: redactDiagnostic,
      emit: (message) => {
        lastRecord = message;
        if (CRASH_RECORD.test(message)) lastCrash = message;
        this.emit("diagnostic", message);
      },
    });
    child.stderr.on("data", (chunk: Buffer) => diagnostics.push(chunk.toString("utf8")));
    child.stderr.once("end", () => diagnostics.flush());
    child.once("close", () => diagnostics.flush());

    child.once("error", (error) => this.#fail(error, child));
    child.once("exit", (code, signal) => {
      if (signal) return this.#fail(new Error(`Codex App Server exited with signal ${signal}.`), child);
      if (code === 0) return this.#fail(new Error("Codex App Server exited with code 0."), child);
      const fail = () => {
        const detail = (lastCrash ?? lastRecord)?.replace(LOG_TIMESTAMP_PREFIX, "") ?? null;
        this.#fail(new AgentProcessExitError(`Codex App Server exited with code ${code ?? "unknown"}.`, detail), child);
      };
      if (child.stderr.readableEnded) return fail();
      const wait = setTimeout(fail, STDERR_END_WAIT_MS);
      child.stderr.once("end", () => {
        clearTimeout(wait);
        fail();
      });
    });
  }

  readonly stop = Effect.fn("CodexAppServer.stop")(function* (this: CodexAppServerClient) {
    const child = this.#process;
    if (!child) {
      if (this.#ending) yield* Fiber.join(this.#ending);
      return;
    }
    this.#stopping = true;
    const sandboxProbe = this.#linuxSandboxFailure;
    this.#linuxSandboxFailure = null;
    if (sandboxProbe) yield* Fiber.interrupt(sandboxProbe);
    this.#cancelToolRequests();
    this.#process = null;
    this.#resendOpenTurns();
    this.#forgetTurns();
    for (const pending of this.#pending.values()) pending.reject(new Error("Codex App Server stopped."));
    this.#pending.clear();
    child.stdin.end();
    yield* endProcessTree(child).pipe(Effect.orDie);
  }, Effect.uninterruptible);

  readonly releaseThread = Effect.fn("CodexAppServer.releaseThread")(function* (
    this: CodexAppServerClient,
    threadId: string,
    resumes = false,
  ) {
    if (!resumes) this.#turnContext.forget(threadId);
    if (!this.running) return;
    yield* this.request("thread/unsubscribe", { threadId }, decodeRecordResponse);
  });

  readonly holdsBackgroundWork = Effect.fn("CodexAppServer.holdsBackgroundWork")(function* (
    this: CodexAppServerClient,
    threadId: string,
  ) {
    const terminals = yield* this.request(
      "thread/backgroundTerminals/list",
      { threadId, limit: 1 },
      decodeBackgroundTerminals,
    );
    return terminals.data.length > 0;
  });

  readonly replaceForNextTurn = Effect.fn("CodexAppServer.replaceForNextTurn")(function* (
    this: CodexAppServerClient,
    threadIds: readonly string[],
  ) {
    if (!this.#holdsOnlyAbandonedTurns()) return false;
    const since = Math.min(...[...this.#abandonedTurns.values()].map(({ at }) => at));
    if (Date.now() - since >= ABANDONED_PROCESS_BACKGROUND_HOLD_MS) return true;
    const stopped = this.#abandonedThreads();
    const checks = yield* Effect.forEach(
      threadIds.filter((threadId) => !stopped.has(threadId)),
      (threadId) => Effect.result(this.holdsBackgroundWork(threadId)),
      { concurrency: "unbounded" },
    );
    if (checks.some((background) => Result.isFailure(background) || background.success)) return false;
    return this.#holdsOnlyAbandonedTurns();
  });

  #abandonedThreads(): ReadonlySet<string> {
    return new Set([...this.#abandonedTurns.values()].map(({ threadId }) => threadId));
  }

  #holdsOnlyAbandonedTurns(): boolean {
    return (
      this.running &&
      this.#abandonedTurns.size > 0 &&
      this.#liveTurns.size === 0 &&
      this.#openTurns.size === 0 &&
      this.#threadWork === 0
    );
  }

  readonly archiveThread = Effect.fn("CodexAppServer.archiveThread")(function* (
    this: CodexAppServerClient,
    threadId: string,
  ) {
    if (!this.running) return;
    yield* this.request("thread/archive", { threadId }, decodeRecordResponse);
  });

  readonly newestTurnId = Effect.fn("CodexAppServer.newestTurnId")(function* (
    this: CodexAppServerClient,
    threadId: string,
  ) {
    const page = yield* this.request(
      "thread/turns/list",
      { threadId, limit: 1, sortDirection: "desc", itemsView: "notLoaded" },
      decodeTurnHistoryPage,
    );
    return page.data[0]?.id ?? null;
  });

  readonly nameThread = Effect.fn("CodexAppServer.nameThread")(function* (
    this: CodexAppServerClient,
    threadId: string,
    name: string,
  ) {
    if (!this.running) return;
    yield* this.request("thread/name/set", { threadId, name }, decodeRecordResponse);
  });

  readonly readHistory = Effect.fn("CodexAppServer.readHistory")(function* (
    this: CodexAppServerClient,
    request: ProviderHistoryRequest,
    consume: ProviderHistoryConsumer,
  ) {
    let cursor: string | undefined;
    const seenTurnCursors = new Set<string>();
    while (true) {
      const page = yield* this.request(
        "thread/turns/list",
        {
          threadId: request.threadId,
          limit: PROVIDER_HISTORY_PAGE_SIZE,
          sortDirection: "desc",
          itemsView: "notLoaded",
          ...(cursor === undefined ? {} : { cursor }),
        },
        decodeTurnHistoryPage,
      );

      for (const turn of page.data) {
        if (request.items === "none") {
          if (!(yield* consume(toHistoryFragment(turn, [], true)))) return;
          continue;
        }

        let itemCursor: string | undefined;
        const seenItemCursors = new Set<string>();
        let itemOffset = 0;
        while (true) {
          const itemPage = yield* this.request(
            "thread/items/list",
            {
              threadId: request.threadId,
              turnId: turn.id,
              limit: PROVIDER_HISTORY_PAGE_SIZE,
              sortDirection: "asc",
              ...(itemCursor === undefined ? {} : { cursor: itemCursor }),
            },
            decodeItemHistoryPage,
          );
          if (itemPage.data.some((entry) => entry.turnId !== turn.id)) {
            return yield* new ProviderClientOperationError({
              cause: new Error("Codex returned an item for the wrong turn."),
            });
          }
          const complete = itemPage.nextCursor === null;
          if (
            !(yield* consume(
              toHistoryFragment(
                turn,
                itemPage.data.map((entry) => entry.item),
                complete,
                itemOffset,
              ),
            ))
          )
            return;
          itemOffset += itemPage.data.length;
          if (complete) break;
          const nextItemCursor = freshCursor(itemPage.nextCursor, itemCursor, seenItemCursors, "item");
          if (nextItemCursor instanceof ProviderClientOperationError) return yield* nextItemCursor;
          itemCursor = nextItemCursor;
        }
      }

      if (page.nextCursor === null) return;
      const nextTurnCursor = freshCursor(page.nextCursor, cursor, seenTurnCursors, "turn");
      if (nextTurnCursor instanceof ProviderClientOperationError) return yield* nextTurnCursor;
      cursor = nextTurnCursor;
    }
  });

  readonly request = Effect.fn("CodexAppServer.request")(function* <T>(
    this: CodexAppServerClient,
    method: string,
    params: unknown,
    decoder: ResponseDecoder<T>,
    timeoutMs = this.#requestTimeoutMs,
  ): Effect.fn.Return<T, ProviderClientOperationError> {
    const child = this.#process;
    const counted = THREAD_WORK_METHODS.has(method);
    if (counted) this.#threadWork += 1;
    return yield* Effect.gen({ self: this }, function* () {
      const threadId =
        (method === "turn/start" || method === "turn/steer") && isRecord(params) && isString(params.threadId)
          ? params.threadId
          : null;
      const abandoned = () => threadId !== null && this.#abandonedThreads().has(threadId);
      const busy = () => new ProviderClientOperationError({ cause: new ProviderSessionBusyError("Codex") });
      if (abandoned()) return yield* busy();
      let sent = params;
      if (EFFORT_METHODS.has(method) && carriesEffort(params)) {
        if (!this.#catalog) {
          const result = yield* Effect.result(
            this.readModelCatalog(Math.min(timeoutMs, providerCheckTimeoutMs(5_000))),
          );
          if (this.#process !== child || this.#stopping) {
            if (Result.isFailure(result)) return yield* result.failure;
            return yield* new ProviderClientOperationError({
              cause: new ProviderStoppedError("Codex", "Codex App Server stopped while listing models."),
            });
          }
          if (abandoned()) return yield* busy();
        }
        sent = withDeclaredEffort(params, this.#catalog);
      }
      return yield* this.#sendRequest(method, sent, decoder, child);
    }).pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () =>
          Effect.sync(() => this.#checkAnswering(child, timeoutMs)).pipe(
            Effect.andThen(
              Effect.fail(new ProviderClientOperationError({ cause: new RequestTimeoutError("Codex", method) })),
            ),
          ),
      }),
      Effect.ensuring(
        Effect.sync(() => {
          if (counted) this.#threadWork -= 1;
        }),
      ),
    );
  });

  #sendRequest<T>(
    method: string,
    params: unknown,
    decoder: ResponseDecoder<T>,
    child: ChildProcessWithoutNullStreams | null,
  ) {
    const id = this.#nextId++;
    let answered = false;
    return Effect.callback<T, ProviderClientOperationError>((resume) => {
      this.#pending.set(id, {
        resolve: (value) => {
          answered = true;
          this.#trackTurnContext(method, params, value);
          resume(
            Effect.try({
              try: () => decoder(value),
              catch: (cause) => new ProviderClientOperationError({ cause }),
            }),
          );
        },
        reject: (cause) => resume(Effect.fail(new ProviderClientOperationError({ cause }))),
      });
      try {
        this.#write({ method, id, params: this.#wireParams(method, params) });
        if (method === "turn/interrupt" && isRecord(params) && isString(params.threadId) && isString(params.turnId)) {
          this.#interruptedTurns.add(JSON.stringify([params.threadId, params.turnId]));
          this.#cancelToolRequests(params.threadId, params.turnId);
          this.#watchStop(params.threadId, params.turnId, id, child);
          this.#stopSubagentsOf(params.threadId);
        }
      } catch (cause) {
        resume(Effect.fail(new ProviderClientOperationError({ cause })));
      }
      return Effect.sync(() => this.#pending.delete(id));
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#pending.delete(id);
          if (method === "turn/start" && !answered && isRecord(params) && isString(params.threadId))
            this.#turnContext.resend(params.threadId);
        }),
      ),
    );
  }

  readonly readModelCatalog = Effect.fn("CodexAppServer.readModelCatalog")(function* (
    this: CodexAppServerClient,
    timeoutMs: number,
  ): Effect.fn.Return<ModelListResponse, ProviderClientOperationError> {
    if (this.#catalogRead) return yield* Deferred.await(this.#catalogRead);
    const pending = Deferred.makeUnsafe<ModelListResponse, ProviderClientOperationError>();
    this.#catalogRead = pending;
    return yield* this.#readModelPages(timeoutMs).pipe(
      Effect.onExit((exit) => {
        if (this.#catalogRead === pending) this.#catalogRead = null;
        return Deferred.done(pending, exit);
      }),
    );
  }).bind(this);

  readonly #readModelPages = Effect.fn("CodexAppServer.readModelPages")(function* (
    this: CodexAppServerClient,
    timeoutMs: number,
  ): Effect.fn.Return<ModelListResponse, ProviderClientOperationError> {
    const child = this.#process;
    const cursors = new Set<string>();
    const byModel = new Map<string, ModelListResponse["data"][number]>();
    let cursor: string | undefined;
    do {
      const page = yield* this.request(
        "model/list",
        { limit: 100, includeHidden: true, ...(cursor ? { cursor } : {}) },
        decodeModelListResponse,
        timeoutMs,
      );
      if (this.#process !== child || this.#stopping)
        return yield* new ProviderClientOperationError({
          cause: new ProviderStoppedError("Codex", "Codex App Server stopped while listing models."),
        });
      for (const option of page.data) {
        const id = option.model?.trim();
        if (id) byModel.set(id, option);
      }
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor))
        return yield* new ProviderClientOperationError({
          cause: new Error("Model discovery repeated a pagination cursor."),
        });
      if (cursor) cursors.add(cursor);
    } while (cursor);
    const catalog = new Map<string, DeclaredReasoningEfforts>();
    for (const [id, option] of byModel) {
      const declared = declaredReasoningEfforts(option);
      if (declared) catalog.set(id, declared);
    }
    this.#catalog = catalog;
    return { data: [...byModel.values()] } satisfies ModelListResponse;
  });

  notify(method: string, params: unknown = {}): void {
    this.#write({ method, params });
  }

  respond(id: RequestId, result: unknown): void {
    const codexId = this.#takeServerRequestId(id);
    if (codexId !== undefined) this.#write({ id: codexId, result });
  }

  respondError(id: RequestId, error: RpcError): void {
    const codexId = this.#takeServerRequestId(id);
    if (codexId !== undefined) this.#write({ id: codexId, error });
  }

  #wireParams(method: string, params: unknown): unknown {
    if (method === "thread/start") return withoutTurnContextParams(params);
    if (method === "thread/resume") return { ...withoutTurnContextParams(params), excludeTurns: true };
    if (method !== "turn/start" || !isRecord(params) || !isString(params.threadId) || !Array.isArray(params.input))
      return params;
    const blocks = this.#turnContext.take(params.threadId);
    if (blocks.length === 0) return params;
    return { ...params, input: [...blocks.map((text) => ({ type: "text", text })), ...params.input] };
  }

  #trackTurnContext(method: string, params: unknown, result: unknown): void {
    if (method === "thread/start") {
      const thread = isRecord(result) ? result.thread : undefined;
      if (!isRecord(thread) || !isString(thread.id)) return;
      this.#turnContext.set(thread.id, params, false);
      return;
    }
    if (!isRecord(params) || !isString(params.threadId)) return;
    if (method === "turn/start") {
      this.#openTurns.add(params.threadId);
      const turn = isRecord(result) ? result.turn : undefined;
      if (!isRecord(turn) || !isString(turn.id)) return;
      this.#liveTurns.add(JSON.stringify([params.threadId, turn.id]));
      if (
        process.platform === "linux" &&
        isString(params.cwd) &&
        isRecord(params.sandboxPolicy) &&
        params.sandboxPolicy.type === "workspaceWrite"
      )
        this.#checkLinuxSandbox(params.threadId, turn.id, params.cwd);
    } else if (method === "thread/resume") this.#turnContext.set(params.threadId, params, true);
    else if (method === "thread/archive" || method === "thread/delete") this.#turnContext.forget(params.threadId);
    else if (method === "thread/revert") this.#turnContext.resend(params.threadId);
  }

  #observeTurnContext(method: string, params: unknown): void {
    if (!isRecord(params) || !isString(params.threadId)) return;
    if (method === "turn/completed") this.#openTurns.delete(params.threadId);
    const failed = method === "turn/completed" && isRecord(params.turn) && params.turn.status === "failed";
    const compacted =
      method === "thread/compacted" ||
      (method === "item/completed" && isRecord(params.item) && params.item.type === "contextCompaction");
    if (failed || compacted) this.#turnContext.resend(params.threadId);
  }

  #warnSandboxFailure(method: string, params: unknown): void {
    if (!isRecord(params) || !isString(params.threadId)) return;
    const { threadId } = params;
    if (method === "turn/completed") {
      if (isRecord(params.turn) && params.turn.id === this.#sandboxWarnings.get(threadId))
        this.#sandboxWarnings.delete(threadId);
      return;
    }
    const item = params.item;
    if (
      method !== "item/completed" ||
      !isString(params.turnId) ||
      !isRecord(item) ||
      item.type !== "commandExecution" ||
      item.status !== "failed" ||
      !isString(item.aggregatedOutput) ||
      !(WINDOWS_SANDBOX_FAILURE.test(item.aggregatedOutput) || LINUX_SANDBOX_FAILURE.test(item.aggregatedOutput)) ||
      this.#sandboxWarnings.get(threadId) === params.turnId
    )
      return;
    this.#warnSandboxUnavailable(threadId, params.turnId);
  }

  #checkLinuxSandbox(threadId: string, turnId: string, cwd: string): void {
    const child = this.#process;
    const turnKey = JSON.stringify([threadId, turnId]);
    this.#linuxSandboxFailure ??= Effect.runFork(
      linuxSandboxFailure(this.#executable, codexEnvironment(this.#extraEnv), cwd),
    );
    const probe = this.#linuxSandboxFailure;
    Effect.runFork(
      Fiber.join(probe).pipe(
        Effect.tap((failure) =>
          Effect.sync(() => {
            if (failure === undefined && this.#linuxSandboxFailure === probe) this.#linuxSandboxFailure = null;
            if (typeof failure !== "string" || this.#process !== child || !this.#liveTurns.has(turnKey)) return;
            if (this.#sandboxWarnings.get(threadId) !== turnId) this.#warnSandboxUnavailable(threadId, turnId);
          }),
        ),
      ),
    );
  }

  #warnSandboxUnavailable(threadId: string, turnId: string): void {
    this.#sandboxWarnings.set(threadId, turnId);
    this.emit("notification", {
      method: "warning",
      params: { threadId, turnId, message: sourceText("error.agent.codexSandboxUnavailable") },
    });
  }

  #resendOpenTurns(): void {
    for (const threadId of this.#openTurns) this.#turnContext.resend(threadId);
    this.#openTurns.clear();
  }

  #takeServerRequestId(id: RequestId): RequestId | undefined {
    this.#toolRequests.delete(id);
    if (!isString(id)) return undefined;
    const host = this.#hostRequests.get(id);
    this.#hostRequests.delete(id);
    if (host) this.#noteTurnActivity(host.threadId);
    const codexId = this.#serverRequestIds.get(id);
    this.#serverRequestIds.delete(id);
    return codexId;
  }

  #write(message: unknown): void {
    if (!this.running || !this.#process) {
      throw new ProviderStoppedError("Codex", "Codex App Server is not running.");
    }
    this.#process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleMessage(message: RpcMessage): void {
    if ("method" in message) {
      if ("id" in message) {
        const requestTurn = notificationTurnKey(message.params);
        if (requestTurn !== null && this.#abandonedTurns.has(requestTurn)) {
          this.#write({ id: message.id, error: { code: -32_000, message: "OpenBot stopped this turn." } });
          return;
        }
        const id = randomUUID();
        this.#serverRequestIds.set(id, message.id);
        if (requestTurn !== null && isRecord(message.params) && isString(message.params.threadId))
          this.#hostRequests.set(id, { threadId: message.params.threadId, turnKey: requestTurn });
        let signal: AbortSignal | undefined;
        if (
          message.method === "item/tool/call" &&
          isRecord(message.params) &&
          isString(message.params.threadId) &&
          isString(message.params.turnId)
        ) {
          const controller = new AbortController();
          this.#toolRequests.set(id, {
            threadId: message.params.threadId,
            turnId: message.params.turnId,
            controller,
          });
          signal = controller.signal;
          if (this.#interruptedTurns.has(JSON.stringify([message.params.threadId, message.params.turnId]))) {
            this.#toolRequests.delete(id);
            controller.abort();
          }
        }
        this.emit("request", {
          ...(signal ? { signal } : {}),
          method: message.method,
          id,
          params: message.params,
        });
      } else {
        const turnKey = notificationTurnKey(message.params);
        if (turnKey !== null && this.#abandonedTurns.has(turnKey)) {
          if (message.method === "turn/completed") this.#abandonedTurns.delete(turnKey);
          return;
        }
        if (turnKey !== null && message.method === "turn/started") this.#liveTurns.add(turnKey);
        this.#observeTurnClock(message.method, message.params, turnKey);
        if (turnKey !== null && message.method === "turn/completed") this.#endStopWatch(turnKey);
        this.#observeSubagents(message.method, message.params);
        if (
          message.method === "turn/completed" &&
          isRecord(message.params) &&
          isString(message.params.threadId) &&
          isRecord(message.params.turn) &&
          isString(message.params.turn.id)
        ) {
          this.#cancelToolRequests(message.params.threadId, message.params.turn.id);
          this.#interruptedTurns.delete(JSON.stringify([message.params.threadId, message.params.turn.id]));
        }
        this.#observeTurnContext(message.method, message.params);
        this.emit("notification", { method: message.method, params: message.params });
        this.#warnSandboxFailure(message.method, message.params);
      }
      return;
    }

    const pending = this.#pending.get(message.id);
    if (!pending) return;

    this.#pending.delete(message.id);

    if (message.error && isRecord(message.error)) {
      const code = isNumber(message.error.code) ? message.error.code : -1;
      const text = isString(message.error.message) ? message.error.message : "Unknown error";
      pending.reject(new AppServerError(text, code, message.error.data));
      return;
    }

    pending.resolve(message.result);
  }

  #watchStop(threadId: string, turnId: string, requestId: RequestId, child: ChildProcessWithoutNullStreams | null) {
    const key = JSON.stringify([threadId, turnId]);
    const watch = this.#stopWatches.get(key);
    if (watch) {
      watch.requests.push(requestId);
      return;
    }
    const timer = setTimeout(() => this.#abandonStoppedTurn(threadId, turnId, child), CODEX_STOP_GRACE_MS);
    timer.unref?.();
    this.#stopWatches.set(key, { timer, requests: [requestId] });
  }

  #endStopWatch(key: string): void {
    this.#liveTurns.delete(key);
    const watch = this.#stopWatches.get(key);
    if (watch) clearTimeout(watch.timer);
    this.#stopWatches.delete(key);
  }

  #abandonStoppedTurn(
    threadId: string,
    turnId: string,
    child: ChildProcessWithoutNullStreams | null,
    status: "interrupted" | "failed" = "interrupted",
  ): void {
    const key = JSON.stringify([threadId, turnId]);
    const watch = this.#stopWatches.get(key);
    if (watch) clearTimeout(watch.timer);
    const requests = watch?.requests ?? [];
    this.#stopWatches.delete(key);
    if (this.#process !== child || !this.#liveTurns.has(key)) return;
    this.#handleMessage({
      method: "turn/completed",
      params: { threadId, turn: { id: turnId, status } },
    });
    this.#abandonedTurns.set(key, { threadId, at: Date.now() });
    this.#turnContext.resend(threadId);
    for (const id of requests) {
      const pending = this.#pending.get(id);
      this.#pending.delete(id);
      pending?.resolve({});
    }
  }

  #observeTurnClock(method: string, params: unknown, turnKey: string | null): void {
    if (!isRecord(params) || !isString(params.threadId)) return;
    if (method === "turn/completed") {
      if (turnKey !== null) this.#forgetTurnClock(turnKey);
      return;
    }
    if (method === "turn/started" && turnKey !== null && isRecord(params.turn) && isString(params.turn.id)) {
      const turnId = params.turn.id;
      this.#turnClocks.set(turnKey, {
        threadId: params.threadId,
        turnId,
        lastActivityAt: Date.now(),
        openItems: new Set(),
      });
      this.#startStallCheck();
    }
    const clock = turnKey === null ? undefined : this.#turnClocks.get(turnKey);
    const item = params.item;
    if (clock && isRecord(item) && isString(item.id) && !OUTPUT_ITEM_TYPES.has(item.type)) {
      if (method === "item/started") clock.openItems.add(item.id);
      else if (method === "item/completed") clock.openItems.delete(item.id);
    }
    this.#noteTurnActivity(params.threadId);
  }

  #noteTurnActivity(threadId: string): void {
    const now = Date.now();
    for (const clock of this.#turnClocks.values())
      if (this.#isSubagentOf(threadId, clock.threadId)) clock.lastActivityAt = now;
  }

  #forgetTurnClock(turnKey: string): void {
    this.#turnClocks.delete(turnKey);
    for (const [id, request] of this.#hostRequests) if (request.turnKey === turnKey) this.#hostRequests.delete(id);
    if (this.#turnClocks.size === 0 && this.#stallCheck) {
      clearInterval(this.#stallCheck.timer);
      this.#stallCheck = null;
    }
  }

  #startStallCheck(): void {
    if (this.#stallCheck) return;
    const timer = setInterval(() => this.#checkStalls(), CODEX_STALL_CHECK_MS);
    timer.unref?.();
    this.#stallCheck = { timer, at: Date.now() };
  }

  #checkStalls(): void {
    const check = this.#stallCheck;
    if (!check) return;
    const now = Date.now();
    const asleep = now - check.at - CODEX_STALL_CHECK_MS;
    check.at = now;
    for (const [key, clock] of this.#turnClocks) {
      if (asleep > CODEX_STALL_CHECK_MS) clock.lastActivityAt = Math.min(now, clock.lastActivityAt + asleep);
      const silentFor = now - clock.lastActivityAt;
      const limit = clock.openItems.size > 0 ? CODEX_TOOL_STALL_MS : CODEX_TURN_STALL_MS;
      if (
        silentFor < limit ||
        this.#subagentParents.has(clock.threadId) ||
        this.#interruptedTurns.has(key) ||
        [...this.#hostRequests.values()].some((request) => this.#isSubagentOf(request.threadId, clock.threadId))
      )
        continue;
      this.#endStalledTurn(clock, silentFor);
    }
  }

  #endStalledTurn(clock: TurnClock, silentFor: number): void {
    const { threadId, turnId } = clock;
    logger.warn("Ended a Codex turn that sent nothing past the stall limit.", {
      threadId,
      silentForMinutes: Math.floor(silentFor / 60_000),
      openItems: clock.openItems.size,
    });
    const child = this.#process;
    Effect.runFork(this.request("turn/interrupt", { threadId, turnId }, decodeRecordResponse).pipe(Effect.ignore));
    this.#handleMessage({
      method: "error",
      params: {
        threadId,
        turnId,
        message: sourceText("error.agent.turnStalled", { provider: agentProviderName("codex") }),
        causeCode: "stalled",
      },
    });
    this.#abandonStoppedTurn(threadId, turnId, child, "failed");
  }

  #observeSubagents(method: string, params: unknown): void {
    if (!isRecord(params) || !isString(params.threadId)) return;
    const threadId = params.threadId;
    if (method === "turn/started") {
      const turnId = isRecord(params.turn) ? params.turn.id : undefined;
      if (!isString(turnId)) return;
      const parent = this.#subagentParents.get(threadId);
      if (parent !== undefined && this.#stoppedParents.has(parent)) this.#stopSubagentTurn(threadId, turnId);
      else if (!this.#interruptedTurns.has(JSON.stringify([threadId, turnId]))) this.#stoppedParents.delete(threadId);
      return;
    }
    if ((method !== "item/started" && method !== "item/completed") || !isRecord(params.item)) return;
    const item = params.item;
    const children =
      item.type === "collabAgentToolCall" &&
      SUBAGENT_OWNER_TOOLS.has(item.tool) &&
      Array.isArray(item.receiverThreadIds)
        ? item.receiverThreadIds.filter(isString)
        : item.type === "subAgentActivity" && isString(item.agentThreadId)
          ? [item.agentThreadId]
          : [];
    for (const child of children) {
      if (this.#subagentParents.get(child) === threadId || this.#isSubagentOf(threadId, child)) continue;
      this.#subagentParents.set(child, threadId);
      if (this.#stoppedParents.has(threadId)) this.#stopSubagent(child);
    }
  }

  #isSubagentOf(threadId: string, ancestor: string): boolean {
    for (
      let current: string | undefined = threadId;
      current !== undefined;
      current = this.#subagentParents.get(current)
    )
      if (current === ancestor) return true;
    return false;
  }

  #stopSubagentsOf(threadId: string): void {
    this.#stoppedParents.add(threadId);
    for (const [child, parent] of this.#subagentParents) if (parent === threadId) this.#stopSubagent(child);
  }

  #stopSubagent(threadId: string): void {
    const prefix = `${JSON.stringify([threadId]).slice(0, -1)},`;
    for (const key of this.#liveTurns) {
      const turnId = key.startsWith(prefix) ? JSON.parse(key)[1] : undefined;
      if (isString(turnId)) this.#stopSubagentTurn(threadId, turnId);
    }
    this.#stopSubagentsOf(threadId);
  }

  #stopSubagentTurn(threadId: string, turnId: string): void {
    if (this.#interruptedTurns.has(JSON.stringify([threadId, turnId]))) return;
    Effect.runFork(this.request("turn/interrupt", { threadId, turnId }, decodeRecordResponse).pipe(Effect.ignore));
  }

  #forgetTurns(): void {
    for (const watch of this.#stopWatches.values()) clearTimeout(watch.timer);
    this.#stopWatches.clear();
    this.#liveTurns.clear();
    this.#abandonedTurns.clear();
    this.#subagentParents.clear();
    this.#stoppedParents.clear();
    this.#turnClocks.clear();
    this.#hostRequests.clear();
    if (this.#stallCheck) clearInterval(this.#stallCheck.timer);
    this.#stallCheck = null;
  }

  #cancelToolRequests(threadId?: string, turnId?: string): void {
    if (threadId === undefined) this.#interruptedTurns.clear();
    for (const [id, request] of this.#toolRequests) {
      if (threadId !== undefined && (request.threadId !== threadId || request.turnId !== turnId)) continue;
      this.#toolRequests.delete(id);
      request.controller.abort();
    }
  }

  #checkAnswering(child: ChildProcessWithoutNullStreams | null, timeoutMs: number): void {
    if (this.#probing || !child || this.#process !== child || timeoutMs < this.#requestTimeoutMs) return;
    this.#probing = true;
    Effect.runFork(
      this.request("config/read", { includeLayers: false }, decodeRecordResponse).pipe(
        Effect.catch((failure) =>
          Effect.sync(() => {
            if (this.#process !== child || !(failure.cause instanceof RequestTimeoutError)) return;
            this.#fail(new Error(sourceText("error.provider.codexUnresponsive")), child);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            this.#probing = false;
          }),
        ),
      ),
    );
  }

  #fail(error: Error, child: ChildProcessWithoutNullStreams): void {
    if (this.#process !== child) return;
    this.#cancelToolRequests();
    this.#process = null;
    this.#resendOpenTurns();
    this.#forgetTurns();

    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();

    this.#ending = Effect.runFork(endProcessTree(child).pipe(Effect.orDie));
    if (!this.#stopping) this.emit("exit", error);
  }
}

interface HistoryTurn {
  id: string;
  status?: string;
  startedAt?: number;
}

interface HistoryTurnPage {
  data: HistoryTurn[];
  nextCursor: string | null;
}

interface HistoryItemPage {
  data: Array<{ turnId: string; item: ThreadItem }>;
  nextCursor: string | null;
}

function carriesEffort(params: unknown): params is DynamicRecord {
  if (!isRecord(params) || !isString(params.model)) return false;
  return isString(params.effort) || (isRecord(params.config) && isString(params.config.model_reasoning_effort));
}

function withDeclaredEffort(params: DynamicRecord, catalog: DeclaredCatalog | null): DynamicRecord {
  const declared = isString(params.model) ? catalog?.get(params.model) : undefined;
  if (!declared) return params;
  const unlisted = (effort: unknown) => isString(effort) && !declared.efforts.some((level) => level === effort);
  const effort = unlisted(params.effort);
  const config = isRecord(params.config) && unlisted(params.config.model_reasoning_effort) ? params.config : null;
  if (!effort && !config) return params;
  return {
    ...params,
    ...(effort ? { effort: declared.fallback } : {}),
    ...(config ? { config: { ...config, model_reasoning_effort: declared.fallback } } : {}),
  };
}

function codexEnvironment(extraEnv: Readonly<Record<string, string>> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  for (const key of Object.keys(env)) if (key.toUpperCase() === CODEX_APP_SANDBOX_ENV) delete env[key];
  return env;
}

const linuxSandboxFailure = Effect.fn("CodexAppServer.linuxSandboxFailure")(function* (
  executable: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
) {
  const target = cliSpawnTarget(executable, ["sandbox", "--", "/bin/true"]);
  const output = yield* Effect.callback<string | undefined>((resume) => {
    let child: ChildProcess;
    try {
      child = spawn(target.command, target.args, { stdio: ["ignore", "ignore", "pipe"], env, cwd, windowsHide: true });
    } catch {
      resume(Effect.succeed(undefined));
      return;
    }
    registerProviderProcess(child, "codex");
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < LINUX_SANDBOX_PROBE_OUTPUT_LIMIT) stderr += chunk.toString("utf8");
    });
    child.once("error", () => resume(Effect.succeed(undefined)));
    child.once("close", () => resume(Effect.succeed(stderr)));
    return Effect.sync(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    });
  }).pipe(Effect.timeoutOrElse({ duration: LINUX_SANDBOX_PROBE_TIMEOUT_MS, orElse: () => Effect.succeed(undefined) }));
  if (output === undefined) return undefined;
  const failure = output.split("\n").find((line) => LINUX_SANDBOX_FAILURE.test(line)) ?? null;
  if (failure !== null) logger.warn("The Codex sandbox cannot start on this computer.", { detail: failure.trim() });
  return failure;
});

function withoutTurnContextParams(params: unknown): DynamicRecord {
  if (!isRecord(params)) return {};
  const {
    memoryContext: _memories,
    sectionTeammates: _section,
    savedLogins: _logins,
    turnStyleReminder: _style,
    ...rest
  } = params;
  return rest;
}

function decodeTurnHistoryPage(value: unknown): HistoryTurnPage {
  const record = decodeRecordResponse(value);
  if (!Array.isArray(record.data)) throw new Error("Invalid Codex turn history page.");
  return {
    data: record.data.map(decodeHistoryTurn),
    nextCursor: nullableString(record.nextCursor, "turn history cursor"),
  };
}

function decodeHistoryTurn(value: unknown): HistoryTurn {
  if (!isRecord(value) || !isString(value.id)) throw new Error("Invalid Codex history turn.");
  const status = value.status;
  const startedAt = value.startedAt;
  return {
    id: value.id,
    ...(isString(status) ? { status } : {}),
    ...(typeof startedAt === "number" && Number.isFinite(startedAt) ? { startedAt } : {}),
  };
}

function decodeItemHistoryPage(value: unknown): HistoryItemPage {
  const record = decodeRecordResponse(value);
  if (!Array.isArray(record.data)) throw new Error("Invalid Codex item history page.");
  return {
    data: record.data.map(decodeHistoryItemEntry),
    nextCursor: nullableString(record.nextCursor, "item history cursor"),
  };
}

function decodeHistoryItemEntry(value: unknown): { turnId: string; item: ThreadItem } {
  if (!isRecord(value) || !isString(value.turnId) || !isRecord(value.item) || !isString(value.item.type)) {
    throw new Error("Invalid Codex history item.");
  }
  const item: ThreadItem = { ...value.item, type: value.item.type };
  if (item.type === "userMessage" && Array.isArray(item.content)) {
    const last = item.content.length - 1;
    item.content = item.content.filter(
      (part, index) =>
        index === last || !(part.type === "text" && isString(part.text) && isTurnContextBlock(part.text)),
    );
  }
  return { turnId: value.turnId, item };
}

function nullableString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (!isString(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function toHistoryFragment(
  turn: HistoryTurn,
  items: ThreadItem[],
  complete: boolean,
  itemOffset?: number,
): ProviderHistoryFragment {
  return {
    turnId: turn.id,
    ...(turn.status === undefined ? {} : { status: turn.status }),
    ...(turn.startedAt === undefined ? {} : { startedAt: turn.startedAt }),
    ...(itemOffset === undefined ? {} : { itemOffset }),
    items,
    complete,
  };
}

function freshCursor(
  nextCursor: string | null,
  currentCursor: string | undefined,
  seenCursors: Set<string>,
  kind: "turn" | "item",
): string | ProviderClientOperationError {
  if (nextCursor === null || nextCursor === currentCursor || seenCursors.has(nextCursor)) {
    return new ProviderClientOperationError({ cause: new Error(`Codex returned a repeated ${kind} history cursor.`) });
  }
  seenCursors.add(nextCursor);
  return nextCursor;
}

function redactDiagnostic(message: string): string {
  return message
    .replace(/(?:sk|sess|Bearer|token)[-_a-zA-Z0-9.=]{8,}/gi, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");
}

/** Kept inside the adapter; public callers still receive the native protocol error. */
