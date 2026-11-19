import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { agentProviderName } from "@openbot/contracts/ipc";
import { type DynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Fiber, Result, Schema } from "effect";
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
import { JsonLineDecoder, LineTooLongError } from "./jsonl";
import {
  type AppServerNotification,
  type AppServerRequest,
  decodeRecordResponse,
  isRecord,
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

/**
 * A stderr record that says why a process stopped: a Rust panic, a `FATAL` record, or what a `main`
 * that returned an error prints (`Error: …`, `fatal: …`). Codex's `ERROR` level does not count. Codex
 * also writes it at each start for things that do not stop it, such as a folder that is not trusted
 * (#4265), and such a record is not the reason for a later exit.
 */
const CRASH_RECORD = /\bpanicked at\b|^(?:\S+\s+)?FATAL\s|^(?:[A-Za-z]*Error|error|fatal)(?: ?\[[^\]]+\])?:\s*\S/u;
/** How long an exit waits for the rest of stderr. A child of Codex can keep the pipe open. */
const STDERR_END_WAIT_MS = 250;
/**
 * The output of a command that the Codex Windows sandbox could not start because Windows cannot
 * decrypt the saved password of a sandbox account (Codex 0.169.0, `windows-sandbox-rs/src/dpapi.rs`).
 * A shell call fails with `execution error: Io(Custom { kind: Other, error: "windows sandbox:
 * CryptUnprotectData failed: 2148073483" })`, and an `exec_command` call with `Failed to create
 * unified exec process: …`. Codex uses this sandbox only for a Workspace only agent, and it does not
 * repair the password. The turn continues, so the user saw only failed commands (#9310).
 * A `registered Core …` failure is the sandbox path of the installed Codex Windows app (#9548).
 */
const WINDOWS_SANDBOX_FAILURE =
  /^(?:execution error|Failed to create unified exec process): .*\b(?:CryptUnprotectData failed|registered Core)\b/su;
/**
 * The output of a command that the Codex Linux sandbox (bubblewrap) could not start because the
 * host does not let it make a user namespace or mount in one: a Docker container, or a host with
 * AppArmor limits on user namespaces. Codex 0.169.0 gives the stderr of `bwrap` as the output of the
 * failed command, for example `bwrap: Failed to make / slave: Operation not permitted` (#9694). The
 * other texts are the user namespace failures that Codex's own check knows
 * (`codex-rs/sandboxing/src/bwrap.rs`), the same failure in the words of bubblewrap before 0.11.1
 * (`creating new namespace`, which Ubuntu 24.04 ships), and the namespace and `pivot_root` failures
 * of a container. Codex uses this sandbox only for a Workspace only agent. Only the start of the
 * output counts, so a command that prints such a line itself does not show the warning.
 */
const LINUX_SANDBOX_FAILURE =
  /^\s*bwrap: (?:Failed to make \/ slave|setting up uid map|No permissions to creat(?:e a new|ing new) namespace|Creating new namespace failed|pivot_root\b|loopback: Failed RTM_NEW(?:ADDR|LINK))/u;
/**
 * Selects the sandbox path of the installed Codex Windows app (Codex 0.169.0,
 * `windows-sandbox-rs/src/app_package.rs`). Codex keeps it in the commands that it runs, so an
 * OpenBot that a Codex app command started has it too. The Codex that OpenBot starts is not that app,
 * so with it each command of a Workspace only agent failed with `registered Core launch requires an
 * installed app` (#9548). Without it, Codex uses its usual Windows sandbox.
 */
const CODEX_APP_SANDBOX_ENV = "CODEX_WINDOWS_REGISTERED_CORE";
/** The page of `thread/backgroundTerminals/list`. Only the count matters to OpenBot. */
const decodeBackgroundTerminals = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(Schema.Unknown) }));
/** The `collabAgentToolCall` tools whose receivers are subagents of the calling thread. */
const SUBAGENT_OWNER_TOOLS: ReadonlySet<unknown> = new Set(["spawnAgent", "resumeAgent", "sendInput"]);
/**
 * How long Codex may take to end a stopped turn before OpenBot ends it, as for ACP and Claude. Codex
 * answers `turn/interrupt` only when the turn ends, and a command that hangs keeps it from ending
 * (#11100).
 */
const CODEX_STOP_GRACE_MS = 10_000;
/**
 * How long the background commands of other threads, such as a dev server, keep a process that still
 * runs a stopped turn. An idle process keeps them as long (`PROVIDER_IDLE_RELEASE_MS`), not longer.
 */
const ABANDONED_PROCESS_BACKGROUND_HOLD_MS = 10 * 60_000;
/**
 * How long a turn may send nothing before OpenBot ends it, as for Claude, Pi and ACP. Codex retries a
 * stopped model stream after 5 minutes and reports each retry, so a turn that works sends something
 * sooner. A turn that stopped held the agent on "working" and its queue until a Stop (#12315).
 */
const CODEX_TURN_STALL_MS = 15 * 60_000;
/**
 * The limit while a tool call, a command or a compaction is open. Codex can reason for minutes with no
 * event after a large tool result (Hermes #112928), and a long command or MCP tool must not be ended.
 */
const CODEX_TOOL_STALL_MS = 60 * 60_000;
/** How often the open turns are checked against the stall limits. */
const CODEX_STALL_CHECK_MS = 60_000;
/** Items that show model output. An open one does not raise the stall limit as a tool does. */
const OUTPUT_ITEM_TYPES: ReadonlySet<unknown> = new Set(["agentMessage", "reasoning", "userMessage", "plan"]);

const logger = createOpenBotLogger("codex-app-server");

/** The clock of a turn that the stall limits watch. */
interface TurnClock {
  threadId: string;
  turnId: string;
  lastActivityAt: number;
  /** The tool, command and compaction items that started and did not complete. */
  openItems: Set<string>;
}
/** The requests that start or continue work on a thread. A process replaced during one would cut it. */
const THREAD_WORK_METHODS: ReadonlySet<string> = new Set([
  "thread/start",
  "thread/resume",
  "thread/fork",
  "thread/compact/start",
  "turn/start",
  "turn/steer",
]);

/** The thread and turn of a notification, in the form of `#interruptedTurns`, or null. */
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
  /**
   * The memories and section-mates go with the turns. Codex keeps the developer instructions that a
   * session started with, also on `thread/resume`, so in the instructions a change reached only a
   * new session, which writes the full conversation to the cache again.
   */
  readonly turnContext = true;
  readonly modelAddressVariable?: string;
  /**
   * Kept by thread across process restarts: a resumed thread holds the blocks that it was sent.
   * Given by the provider context, so it also outlives this client: the idle release replaces the
   * client, and the new one resumed the thread with all blocks again (#6963). `releaseThread` ends
   * it, as the Claude client does: a released session that comes back gets the blocks in full.
   */
  readonly #turnContext: TurnContext;
  readonly #executable: string;
  readonly #requestTimeoutMs: number;
  #decoder = new JsonLineDecoder();
  readonly #pending = new Map<RequestId, PendingRequest>();
  readonly #toolRequests = new Map<RequestId, { threadId: string; turnId: string; controller: AbortController }>();
  /**
   * The Codex id of each server request, by the id OpenBot gives it. Each process numbers its requests
   * from 0, so its ids are not unique among the processes of other accounts or after a restart (#5465).
   */
  readonly #serverRequestIds = new Map<string, RequestId>();
  readonly #interruptedTurns = new Set<string>();
  /**
   * The threads with an answered turn that did not complete. A process that ends during the turn may
   * not have saved the blocks of that turn, so the next turn sends them again.
   */
  readonly #openTurns = new Set<string>();
  /** The turns that run in this process, by thread and turn, from `turn/started` to `turn/completed`. */
  readonly #liveTurns = new Set<string>();
  /** The stop deadline of each stopped turn, and the `turn/interrupt` requests that wait for its end. */
  readonly #stopWatches = new Map<string, { timer: ReturnType<typeof setTimeout>; requests: RequestId[] }>();
  /**
   * The thread of each stopped turn that OpenBot ended after `CODEX_STOP_GRACE_MS`, by thread and turn.
   * This process still runs the turn, and Codex adds a new turn of that thread to it.
   */
  readonly #abandonedTurns = new Map<string, { threadId: string; at: number }>();
  /**
   * The thread that started each subagent thread, from `collabAgentToolCall` and `subAgentActivity`
   * items. Codex sends the items of every thread to each connection.
   */
  readonly #subagentParents = new Map<string, string>();
  /**
   * The threads with a stopped turn whose subagents must stop too, until the thread starts a new turn.
   * Codex stops only the thread that `turn/interrupt` names, and its subagents worked on for hours,
   * while the chat showed them as stopped (#11419).
   */
  readonly #stoppedParents = new Set<string>();
  /**
   * The running turns, by thread and turn, for the stall limits. The check skips a turn of a subagent
   * thread: it ends with the turn that started it.
   */
  readonly #turnClocks = new Map<string, TurnClock>();
  /**
   * The requests of Codex that OpenBot answers, such as an OpenBot tool, an approval or a question to the
   * user, with their thread and turn. The stall limit waits for them, also for those of a subagent.
   */
  readonly #hostRequests = new Map<string, { threadId: string; turnKey: string }>();
  #stallCheck: { timer: ReturnType<typeof setInterval>; at: number } | null = null;
  /** The `THREAD_WORK_METHODS` requests that wait for an answer. */
  #threadWork = 0;
  /** The turn of each thread that showed the sandbox warning, so that a turn shows it once. */
  readonly #sandboxWarnings = new Map<string, string>();
  #process: ChildProcessWithoutNullStreams | null = null;
  /** The end of a process that failed. `stop` waits for it, because `#process` no longer holds it. */
  #ending: Fiber.Fiber<void> | null = null;
  #nextId = 1;
  #stopping = false;
  #probing = false;

  /** Added to the inherited environment, such as the `CODEX_HOME` of an account after the first. */
  readonly #extraEnv: Readonly<Record<string, string>> | undefined;
  readonly #configOverrides: readonly string[];

  constructor(
    executable: string,
    requestTimeoutMs = 30_000,
    extraEnv?: Readonly<Record<string, string>>,
    turnContext = new TurnContext(),
    /** `key=value` config overrides, each given to the app-server as one `-c`. */
    configOverrides: readonly string[] = [],
    /** The variable whose address the overrides send the model requests to. */
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
    this.#decoder = new JsonLineDecoder();
    // An answer to a request of the previous process must not reach a request of this one.
    this.#serverRequestIds.clear();
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
        // Not wrapped: the screen translates this text only when no prefix is in front of it.
        this.#fail(
          error instanceof LineTooLongError ? error : new Error(`Codex protocol error: ${String(error)}`),
          child,
        );
      }
    });

    // Whole records only. A chunk ends wherever the pipe filled up, and half a record is neither
    // readable nor reliably redactable.
    // The runtime only logs these records. An exit names the last crash record, or the last record.
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
      // A signal, or code 0 after Codex handled one, is a stop from outside. The last record is
      // then an unrelated line.
      if (signal) return this.#fail(new Error(`Codex App Server exited with signal ${signal}.`), child);
      if (code === 0) return this.#fail(new Error("Codex App Server exited with code 0."), child);
      const fail = () => {
        const detail = (lastCrash ?? lastRecord)?.replace(LOG_TIMESTAMP_PREFIX, "") ?? null;
        this.#fail(new AgentProcessExitError(`Codex App Server exited with code ${code ?? "unknown"}.`, detail), child);
      };
      // Node can send `exit` before stderr is read to its end, and a CLI that fails writes the
      // reason last. The `end` listener above flushes the held record before this one runs.
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
    this.#cancelToolRequests();
    this.#process = null;
    this.#resendOpenTurns();
    this.#forgetTurns();
    for (const pending of this.#pending.values()) pending.reject(new Error("Codex App Server stopped."));
    this.#pending.clear();
    child.stdin.end();
    yield* endProcessTree(child).pipe(Effect.orDie);
  }, Effect.uninterruptible);

  /**
   * Drops this connection's hold on one thread and keeps the app server for the others.
   *
   * `thread/unsubscribe` is the non-destructive end of a thread: the app server keeps the thread and
   * its history, stops the thread's MCP event streams at once, and unloads the thread - with the
   * MCP servers it started - once nothing is subscribed to it and it is idle. It does not archive
   * or delete. A refresh after an MCP change starts a replacement session for the same public
   * thread, so without this the old session stays loaded there with the servers the user turned off.
   *
   * A thread this connection never subscribed to answers `NotSubscribed`, which is not an error
   * here: either way this side has stopped using it.
   *
   * `resumes`: an idle release. `thread/resume` loads the same rollout, which holds the memories and
   * section-mates that its turns were sent, so they do not go again.
   */
  readonly releaseThread = Effect.fn("CodexAppServer.releaseThread")(function* (
    this: CodexAppServerClient,
    threadId: string,
    resumes = false,
  ) {
    if (!resumes) this.#turnContext.forget(threadId);
    if (!this.running) return;
    yield* this.request("thread/unsubscribe", { threadId }, decodeRecordResponse);
  });

  /**
   * Whether the thread has a background terminal. The unload that follows `thread/unsubscribe`
   * ends every unified exec process of the thread, so a release would stop a dev server or a watch
   * that the agent left running. `thread/backgroundTerminals/list` is an experimental method; the
   * `initialize` request turns on `experimentalApi`.
   */
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

  /**
   * True when this process still runs a stopped turn that OpenBot ended (#11100), and nothing else
   * uses it: no other turn, no session start, and no background command in `threadIds` other than in
   * the threads of those turns. The runtime then replaces the process before the next turn. A failed
   * check keeps the process, and background commands keep it for `ABANDONED_PROCESS_BACKGROUND_HOLD_MS`
   * at most.
   */
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

  /**
   * Moves a replaced thread out of the list that the Codex app and ChatGPT show. Without this, each
   * replacement session adds a row that starts with the OpenBot handoff to the user's own Codex
   * history.
   *
   * `thread/archive` moves the rollout to `archived_sessions` and unloads the thread when it is
   * loaded. `thread/turns/list` and `thread/items/list` still read it, so a history import works,
   * and a resume unarchives it first (`ThreadLifecycle.resumeThread`). A thread that is already
   * archived, or that has no rollout, answers `no rollout found`.
   */
  readonly archiveThread = Effect.fn("CodexAppServer.archiveThread")(function* (
    this: CodexAppServerClient,
    threadId: string,
  ) {
    if (!this.running) return;
    yield* this.request("thread/archive", { threadId }, decodeRecordResponse);
  });

  /**
   * Sets the title that the Codex app and ChatGPT show for the thread. Without a name they show the
   * first text of the first turn, which is an OpenBot turn context block.
   */
  readonly nameThread = Effect.fn("CodexAppServer.nameThread")(function* (
    this: CodexAppServerClient,
    threadId: string,
    name: string,
  ) {
    if (!this.running) return;
    yield* this.request("thread/name/set", { threadId, name }, decodeRecordResponse);
  });

  /**
   * Reads Codex history without asking the app server for the legacy full thread snapshot.
   *
   * The app server returns turns newest first. Items are read one turn at a time in ascending
   * order, so consumers can persist each fragment and stop without retaining the transcript.
   * Cursors belong to this adapter and never cross the provider-history boundary.
   */
  readonly readHistory = Effect.fn("CodexAppServer.readHistory")(function* (
    this: CodexAppServerClient,
    request: ProviderHistoryRequest,
    consume: ProviderHistoryConsumer,
  ) {
    // These endpoints read the persisted rollout directly. Do not resume here: a resume applies
    // runtime settings and can reopen an archived thread while this operation only needs history.
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
  ) {
    const id = this.#nextId++;
    const child = this.#process;
    let answered = false;
    if ((method === "turn/start" || method === "turn/steer") && isRecord(params) && isString(params.threadId)) {
      // Codex would add this turn to the stopped turn that still runs in the thread. The drain tries
      // the message again, and the next try starts it on a new process (#11100).
      if (this.#abandonedThreads().has(params.threadId))
        return yield* Effect.fail(new ProviderClientOperationError({ cause: new ProviderSessionBusyError("Codex") }));
    }
    let counted = false;
    return yield* Effect.callback<T, ProviderClientOperationError>((resume) => {
      if (THREAD_WORK_METHODS.has(method)) {
        this.#threadWork += 1;
        counted = true;
      }
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
          this.#pending.delete(id);
          if (counted) this.#threadWork -= 1;
          // A turn that was refused, timed out or interrupted may not be in the history, so the
          // next turn sends its blocks again.
          if (method === "turn/start" && !answered && isRecord(params) && isString(params.threadId))
            this.#turnContext.resend(params.threadId);
        }),
      ),
    );
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

  /**
   * The params as Codex gets them. The turn context fields stay on this side, and a turn takes its
   * blocks in front of the user's input, each a text item of its own, so that history readers can
   * tell them from the user's text.
   */
  #wireParams(method: string, params: unknown): unknown {
    if (method === "thread/start") return withoutTurnContextParams(params);
    if (method === "thread/resume") return { ...withoutTurnContextParams(params), excludeTurns: true };
    if (method !== "turn/start" || !isRecord(params) || !isString(params.threadId) || !Array.isArray(params.input))
      return params;
    const blocks = this.#turnContext.take(params.threadId);
    if (blocks.length === 0) return params;
    return { ...params, input: [...blocks.map((text) => ({ type: "text", text })), ...params.input] };
  }

  /** Takes the turn context of a thread that Codex started or resumed, and drops it with the thread. */
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
      // A Stop can come before `turn/started`; the stop deadline then still knows the turn.
      const turn = isRecord(result) ? result.turn : undefined;
      if (isRecord(turn) && isString(turn.id)) this.#liveTurns.add(JSON.stringify([params.threadId, turn.id]));
    } else if (method === "thread/resume") this.#turnContext.set(params.threadId, params, true);
    else if (method === "thread/archive" || method === "thread/delete") this.#turnContext.forget(params.threadId);
  }

  /**
   * A failed turn may not be kept, and a compaction summary can leave the blocks out. The next turn
   * of the thread sends them in full.
   */
  #observeTurnContext(method: string, params: unknown): void {
    if (!isRecord(params) || !isString(params.threadId)) return;
    if (method === "turn/completed") this.#openTurns.delete(params.threadId);
    const failed = method === "turn/completed" && isRecord(params.turn) && params.turn.status === "failed";
    const compacted =
      method === "thread/compacted" ||
      (method === "item/completed" && isRecord(params.item) && params.item.type === "contextCompaction");
    if (failed || compacted) this.#turnContext.resend(params.threadId);
  }

  /** Tells the user once in a turn what to do when the Codex sandbox cannot start the agent's commands. */
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
    this.#sandboxWarnings.set(threadId, params.turnId);
    this.emit("notification", {
      method: "warning",
      params: { threadId, turnId: params.turnId, message: sourceText("error.agent.codexSandboxUnavailable") },
    });
  }

  /** The process ended: a turn that did not complete may not be saved, so its thread sends its blocks again. */
  #resendOpenTurns(): void {
    for (const threadId of this.#openTurns) this.#turnContext.resend(threadId);
    this.#openTurns.clear();
  }

  #takeServerRequestId(id: RequestId): RequestId | undefined {
    this.#toolRequests.delete(id);
    if (!isString(id)) return undefined;
    const host = this.#hostRequests.get(id);
    this.#hostRequests.delete(id);
    // The stall limit counts again from the answer.
    if (host) this.#noteTurnActivity(host.threadId);
    const codexId = this.#serverRequestIds.get(id);
    this.#serverRequestIds.delete(id);
    return codexId;
  }

  #write(message: unknown): void {
    // Thrown before the write: Codex did not get this request.
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
          // OpenBot ended this turn: nobody answers its approvals or tool calls any more.
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
          // OpenBot already ended this turn; its late end only shows that it no longer runs.
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

  /** Starts the deadline of a stopped turn, or adds a second Stop of it to that deadline. */
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

  /**
   * Ends a stopped turn that Codex did not end in `CODEX_STOP_GRACE_MS`, as a Stop that Codex
   * confirmed does: the Stop succeeds, and the turn completes as interrupted. Without this, the chat
   * stayed busy and the agent's queue waited until OpenBot restarted (#11100).
   */
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
    // The process that runs the turn is replaced, and it may not have saved the turn's blocks.
    this.#turnContext.resend(threadId);
    for (const id of requests) {
      const pending = this.#pending.get(id);
      this.#pending.delete(id);
      pending?.resolve({});
    }
  }

  /** Keeps the clock of each running turn for the stall limits. An event of the thread or of its subagents counts. */
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

  /** Starts the stall limits again for the turns of this thread and of the threads whose subagent it is. */
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

  /**
   * Ends each turn that sent nothing past its stall limit. A wait for OpenBot, such as an OpenBot tool or
   * a question to the user, does not count, nor does the time the computer sleeps. A subagent's turn
   * ends with the turn that started it.
   */
  #checkStalls(): void {
    const check = this.#stallCheck;
    if (!check) return;
    const now = Date.now();
    // A timer does not run while the computer sleeps, but the clock does.
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

  /**
   * Ends a turn past its stall limit as `#abandonStoppedTurn` ends a Stop that Codex did not confirm, but
   * as failed, with the text that says what to do. The agent's queue goes on, and the next turn of the
   * thread resumes it on a new process.
   */
  #endStalledTurn(clock: TurnClock, silentFor: number): void {
    const { threadId, turnId } = clock;
    logger.warn("Ended a Codex turn that sent nothing past the stall limit.", {
      threadId,
      silentForMinutes: Math.floor(silentFor / 60_000),
      openItems: clock.openItems.size,
    });
    const child = this.#process;
    // Codex may still end the turn. The Stop also stops its subagents and its tool calls.
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

  /**
   * Keeps the link of each subagent thread to its parent. A turn that a subagent of a stopped thread
   * starts is stopped too; a new turn of any other thread lets its own subagents work again.
   */
  #observeSubagents(method: string, params: unknown): void {
    if (!isRecord(params) || !isString(params.threadId)) return;
    const threadId = params.threadId;
    if (method === "turn/started") {
      const turnId = isRecord(params.turn) ? params.turn.id : undefined;
      if (!isString(turnId)) return;
      const parent = this.#subagentParents.get(threadId);
      if (parent !== undefined && this.#stoppedParents.has(parent)) this.#stopSubagentTurn(threadId, turnId);
      // A Stop can come before `turn/started` of the turn that it stops.
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
      // A subagent that the stopped turn started just before its end.
      if (this.#stoppedParents.has(threadId)) this.#stopSubagent(child);
    }
  }

  /** Whether `threadId` is the thread `ancestor` or one of its subagents. Keeps the links free of loops. */
  #isSubagentOf(threadId: string, ancestor: string): boolean {
    for (
      let current: string | undefined = threadId;
      current !== undefined;
      current = this.#subagentParents.get(current)
    )
      if (current === ancestor) return true;
    return false;
  }

  /** Stops the subagents of a stopped thread, and their own subagents. A second Stop sends their Stops again. */
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

  /** Sends the Stop of a subagent's turn. It has the same deadline as a Stop of the person's turn. */
  #stopSubagentTurn(threadId: string, turnId: string): void {
    if (this.#interruptedTurns.has(JSON.stringify([threadId, turnId]))) return;
    Effect.runFork(this.request("turn/interrupt", { threadId, turnId }, decodeRecordResponse).pipe(Effect.ignore));
  }

  /** The process ended: none of its turns runs any more. */
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

  /**
   * Ends a process that stopped answering, so the runtime starts a new one as it does after an exit.
   * Without this a hung app server stays the shared client, and the requests of every agent time out
   * until the user kills it.
   *
   * One request that timed out is not enough: `account/rateLimits/read` waits on the network. So one
   * `config/read` probes the process. That request is local, and every thread start needs it. A
   * process that does not answer it in the request timeout is ended, also when it still sends events:
   * it takes no new work. A request with a shorter timeout, such as a `model/list` that may be slow,
   * starts no probe.
   */
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

/** The environment of the Codex process. Windows compares variable names without case. */
function codexEnvironment(extraEnv: Readonly<Record<string, string>> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  for (const key of Object.keys(env)) if (key.toUpperCase() === CODEX_APP_SANDBOX_ENV) delete env[key];
  return env;
}

/** The params without the fields that `ThreadLifecycle` adds for a client with `turnContext`. */
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
    // Do not retain `items` from the response. `itemsView: notLoaded` is the memory boundary, and
    // the item endpoint below is the only path that materializes item records.
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
  // Preserve provider item fields (tool output, image metadata, command status, and so on) while
  // validating the discriminator at the untrusted app-server boundary.
  const item: ThreadItem = { ...value.item, type: value.item.type };
  // The turn context blocks are text items of their own in front of the user's input. The last
  // item is always the user's, also when the user wrote text that starts like a block.
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

/**
 * The record as it leaves this client. It is not shortened here: the reader redacts the MCP
 * credentials this process handed the CLI, and a value cut in half by a bound applied first is a
 * value that redactor no longer recognises. `shortenDiagnostic` is applied there instead.
 */
function redactDiagnostic(message: string): string {
  return message
    .replace(/(?:sk|sess|Bearer|token)[-_a-zA-Z0-9.=]{8,}/gi, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");
}

/** Kept inside the adapter; public callers still receive the native protocol error. */
