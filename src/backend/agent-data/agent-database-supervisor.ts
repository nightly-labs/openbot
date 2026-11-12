import { Effect } from "effect";
import {
  AGENT_DATABASE_LIMITS,
  type AgentDatabaseFailure,
  type AgentDatabaseHostMessage,
  type AgentDatabaseHostProcess,
  type AgentDatabaseRequest,
  type AgentDatabaseRequestInput,
  type AgentDatabaseRows,
} from "./agent-database-protocol";

export interface AgentDatabaseSupervisorOptions {
  /** Injected: how a host is started differs between the packaged app and a test. */
  spawnHost: () => AgentDatabaseHostProcess;
  /** Input, not a wait: a test sets it low to reach the kill path without sleeping. */
  statementDeadlineMs?: number;
  /** Input, not a wait: a test sets it low to reach a host that never reports ready. */
  hostStartDeadlineMs?: number;
  queueWaitMs?: number;
  /**
   * Reports how long the host took to answer one statement, or to be ended for it. The time starts
   * when the statement is sent, which is never before the host reported ready.
   */
  onStatementSettled?: (durationMs: number) => void;
}

/** The answer to one statement. A failure is a value, never a rejection: every one of these is a
 * sentence the calling agent is meant to read and act on, not an exception for the app. */
export type AgentDatabaseOutcome =
  | { ok: true; result: AgentDatabaseRows }
  | { ok: false; failure: AgentDatabaseFailure };

interface PendingRequest {
  request: AgentDatabaseRequest;
  settle: (outcome: AgentDatabaseOutcome) => void;
  queuedAt: number;
}

const STOPPED_MESSAGE =
  "That statement ran longer than allowed and was stopped. Nothing it was writing was saved. Narrow the query, add an index, or work in smaller batches.";

/**
 * A write can commit in the host before its reply reaches this process, so a write that passes the
 * deadline may be saved. Saying it was not saved made agents write the same rows again (#6311).
 */
const WRITE_STOPPED_MESSAGE =
  "That statement ran longer than allowed and was stopped. It may have been saved before it stopped: read the rows it writes before you run it again. Narrow the query, add an index, or work in smaller batches.";

const EXITED_MESSAGE = "The database process stopped unexpectedly. Try the call again.";

/** No statement was sent, so the statement itself is not the cause and the caller must not change it. */
const NOT_STARTED_MESSAGE = "The database process did not start. Nothing was run. Try the call again.";

/**
 * Owns the one database host and the statement deadline.
 *
 * Knows nothing about agents, names, or tools: it takes an already-resolved request and answers with
 * rows or a failure. One statement is outstanding at a time and the rest wait in a queue here. That
 * single decision is what makes the deadline a true statement deadline rather than queue wait plus
 * execution, makes "which request was running when we ended the host" unambiguous, and makes two
 * agents writing the same database two entries in one queue rather than a locking design.
 *
 * The deadline exists because a runaway statement cannot be interrupted from inside: `sqlite3_step`
 * never returns to JavaScript, so a worker thread's `terminate()` never resolves. Ending the process
 * is the only mechanism that works, which is why the host is a process at all.
 *
 * A new host gets its own start deadline instead, and no statement is sent until the host reports
 * ready. Process start and module load take seconds on a slow computer; counted against the first
 * statement, they ended that statement as a runaway one and reported the start as database time.
 * A host that does not report ready in time, or exits first, fails the requests that waited for it
 * and is discarded. The next request starts a new host, so a host that cannot start is not
 * restarted in a loop.
 */
export class AgentDatabaseSupervisor {
  readonly #spawnHost: () => AgentDatabaseHostProcess;
  readonly #statementDeadlineMs: number;
  readonly #hostStartDeadlineMs: number;
  readonly #queueWaitMs: number;
  readonly #onStatementSettled: ((durationMs: number) => void) | undefined;
  readonly #queue: PendingRequest[] = [];

  #host: AgentDatabaseHostProcess | null = null;
  /** False from the start of a host until its ready message. Nothing is sent to it before. */
  #hostReady = false;
  #inFlight: PendingRequest | null = null;
  #sentAt = 0;
  /** The start deadline while the host starts, then the statement deadline while one runs. */
  #deadline: NodeJS.Timeout | null = null;
  /** Bumped whenever a host is discarded, so a late message from it is dropped rather than matched. */
  #generation = 0;
  #nextId = 1;
  #disposed = false;

  constructor(options: AgentDatabaseSupervisorOptions) {
    this.#spawnHost = options.spawnHost;
    this.#statementDeadlineMs = options.statementDeadlineMs ?? AGENT_DATABASE_LIMITS.statementDeadlineMs;
    this.#hostStartDeadlineMs = options.hostStartDeadlineMs ?? AGENT_DATABASE_LIMITS.hostStartDeadlineMs;
    this.#queueWaitMs = options.queueWaitMs ?? AGENT_DATABASE_LIMITS.queueWaitMs;
    this.#onStatementSettled = options.onStatementSettled;
  }

  send(request: AgentDatabaseRequestInput): Effect.Effect<AgentDatabaseOutcome> {
    return Effect.callback<AgentDatabaseOutcome>((resume) => {
      if (this.#disposed) {
        resume(Effect.succeed(shuttingDown()));
        return;
      }
      const id = this.#nextId++;
      const numbered: AgentDatabaseRequest = request.kind === "statement" ? { ...request, id } : { ...request, id };
      const entry: PendingRequest = {
        request: numbered,
        settle: (outcome) => resume(Effect.succeed(outcome)),
        queuedAt: Date.now(),
      };
      this.#queue.push(entry);
      this.#pump();
      // Cancellation removes queued work only. An executing write keeps its original deadline;
      // dropping its reply must not replay it or terminate another caller's statement.
      return Effect.sync(() => {
        const index = this.#queue.indexOf(entry);
        if (index !== -1) this.#queue.splice(index, 1);
      });
    });
  }

  /**
   * Starts the host before the first statement needs it, so that statement does not wait for the
   * start. Does nothing when a host exists. A start that fails here fails no request.
   */
  prewarm(): void {
    if (this.#disposed) return;
    this.#ensureHost();
  }

  dispose(): void {
    this.#disposed = true;
    this.#clearDeadline();
    const pending = this.#inFlight;
    this.#inFlight = null;
    pending?.settle(shuttingDown());
    while (this.#queue.length > 0) this.#queue.shift()?.settle(shuttingDown());
    this.#generation += 1;
    this.#host?.kill();
    this.#host = null;
    this.#hostReady = false;
  }

  #pump(): void {
    if (this.#inFlight || this.#disposed || this.#queue.length === 0) return;
    const host = this.#ensureHost();
    // `#hostReady` pumps again when the ready message comes.
    if (!this.#hostReady) return;
    const next = this.#queue.shift();
    if (!next) return;
    if (Date.now() - next.queuedAt > this.#queueWaitMs) {
      next.settle(failed("busy", "The database queue was busy for too long. Try the call again."));
      this.#pump();
      return;
    }

    this.#inFlight = next;
    const generation = this.#generation;
    const stopped =
      next.request.kind === "statement" && next.request.mode === "write" ? WRITE_STOPPED_MESSAGE : STOPPED_MESSAGE;
    this.#deadline = setTimeout(() => this.#discardHost(generation, stopped), this.#statementDeadlineMs);
    this.#deadline.unref();
    this.#sentAt = performance.now();
    host.send(next.request);
  }

  #ensureHost(): AgentDatabaseHostProcess {
    if (this.#host) return this.#host;
    const host = this.#spawnHost();
    const generation = this.#generation;
    host.onMessage((message) => this.#message(message, generation));
    host.onExit(() => this.#exited(generation));
    this.#host = host;
    this.#hostReady = false;
    this.#deadline = setTimeout(() => this.#abandonStart(generation), this.#hostStartDeadlineMs);
    this.#deadline.unref();
    return host;
  }

  #message(message: AgentDatabaseHostMessage, generation: number): void {
    if ("kind" in message) this.#ready(generation);
    else this.#receive(message, generation);
  }

  #ready(generation: number): void {
    if (generation !== this.#generation || this.#hostReady) return;
    this.#clearDeadline();
    this.#hostReady = true;
    this.#pump();
  }

  #exited(generation: number): void {
    if (this.#hostReady) this.#discardHost(generation, EXITED_MESSAGE);
    else this.#abandonStart(generation);
  }

  #receive(response: { id: number } & AgentDatabaseOutcome, generation: number): void {
    if (generation !== this.#generation) return;
    const pending = this.#inFlight;
    if (!pending || pending.request.id !== response.id) return;
    this.#clearDeadline();
    this.#inFlight = null;
    pending.settle(response);
    this.#reportSettled();
    this.#pump();
  }

  /**
   * The statement that was running is failed and its host is ended. Everything still queued was
   * never handed to that host, so it is dispatched to a fresh one rather than made collateral.
   */
  #discardHost(generation: number, message: string): void {
    if (generation !== this.#generation || this.#disposed) return;
    this.#endHost();

    const pending = this.#inFlight;
    this.#inFlight = null;
    if (pending) {
      pending.settle(failed("internal", message));
      this.#reportSettled();
    }
    this.#pump();
  }

  /**
   * The host did not report ready in time, or exited first. No statement was sent to it, so every
   * waiting request fails with that reason and none starts another host here: a host that cannot
   * start would otherwise be started again at once, without end.
   */
  #abandonStart(generation: number): void {
    if (generation !== this.#generation || this.#disposed) return;
    this.#endHost();
    // Emptied before the callers hear, so a caller that sends again starts one new host for it.
    const waiting = this.#queue.splice(0);
    for (const entry of waiting) entry.settle(failed("internal", NOT_STARTED_MESSAGE));
  }

  #endHost(): void {
    this.#clearDeadline();
    this.#generation += 1;
    this.#host?.kill();
    this.#host = null;
    this.#hostReady = false;
  }

  #reportSettled(): void {
    this.#onStatementSettled?.(performance.now() - this.#sentAt);
  }

  #clearDeadline(): void {
    if (this.#deadline) clearTimeout(this.#deadline);
    this.#deadline = null;
  }
}

function failed(kind: AgentDatabaseFailure["kind"], message: string): AgentDatabaseOutcome {
  return { ok: false, failure: { kind, message } };
}

function shuttingDown(): AgentDatabaseOutcome {
  return failed("internal", "Shared data is shutting down.");
}
