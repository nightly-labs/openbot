import {
  AGENT_DATABASE_LIMITS,
  type AgentDatabaseFailure,
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
  queueWaitMs?: number;
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
 */
export class AgentDatabaseSupervisor {
  readonly #spawnHost: () => AgentDatabaseHostProcess;
  readonly #statementDeadlineMs: number;
  readonly #queueWaitMs: number;
  readonly #queue: PendingRequest[] = [];

  #host: AgentDatabaseHostProcess | null = null;
  #inFlight: PendingRequest | null = null;
  #deadline: NodeJS.Timeout | null = null;
  /** Bumped whenever a host is discarded, so a late message from it is dropped rather than matched. */
  #generation = 0;
  #nextId = 1;
  #disposed = false;

  constructor(options: AgentDatabaseSupervisorOptions) {
    this.#spawnHost = options.spawnHost;
    this.#statementDeadlineMs = options.statementDeadlineMs ?? AGENT_DATABASE_LIMITS.statementDeadlineMs;
    this.#queueWaitMs = options.queueWaitMs ?? AGENT_DATABASE_LIMITS.queueWaitMs;
  }

  send(request: AgentDatabaseRequestInput): Promise<AgentDatabaseOutcome> {
    if (this.#disposed) return Promise.resolve(shuttingDown());
    const id = this.#nextId++;
    const numbered: AgentDatabaseRequest = request.kind === "statement" ? { ...request, id } : { ...request, id };
    return new Promise<AgentDatabaseOutcome>((settle) => {
      this.#queue.push({ request: numbered, settle, queuedAt: Date.now() });
      this.#pump();
    });
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
  }

  #pump(): void {
    if (this.#inFlight || this.#disposed) return;
    const next = this.#queue.shift();
    if (!next) return;
    if (Date.now() - next.queuedAt > this.#queueWaitMs) {
      next.settle(failed("busy", "The database queue was busy for too long. Try the call again."));
      this.#pump();
      return;
    }

    const host = this.#ensureHost();
    this.#inFlight = next;
    const generation = this.#generation;
    this.#deadline = setTimeout(() => this.#discardHost(generation, STOPPED_MESSAGE), this.#statementDeadlineMs);
    this.#deadline.unref();
    host.send(next.request);
  }

  #ensureHost(): AgentDatabaseHostProcess {
    if (this.#host) return this.#host;
    const host = this.#spawnHost();
    const generation = this.#generation;
    host.onResponse((response) => this.#receive(response, generation));
    host.onExit(() => this.#discardHost(generation, "The database process stopped unexpectedly. Try the call again."));
    this.#host = host;
    return host;
  }

  #receive(response: { id: number } & AgentDatabaseOutcome, generation: number): void {
    if (generation !== this.#generation) return;
    const pending = this.#inFlight;
    if (!pending || pending.request.id !== response.id) return;
    this.#clearDeadline();
    this.#inFlight = null;
    pending.settle(response);
    this.#pump();
  }

  /**
   * The statement that was running is failed and its host is ended. Everything still queued was
   * never handed to that host, so it is dispatched to a fresh one rather than made collateral.
   */
  #discardHost(generation: number, message: string): void {
    if (generation !== this.#generation || this.#disposed) return;
    this.#clearDeadline();
    this.#generation += 1;
    this.#host?.kill();
    this.#host = null;

    const pending = this.#inFlight;
    this.#inFlight = null;
    pending?.settle(failed("internal", message));
    this.#pump();
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
