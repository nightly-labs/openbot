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
  spawnHost: () => AgentDatabaseHostProcess;
  statementDeadlineMs?: number;
  hostStartDeadlineMs?: number;
  queueWaitMs?: number;
  hostStartRetryDelayMs?: number;
  onHostStartFailed?: (failure: AgentDatabaseHostStartFailure) => void;
  onStatementSettled?: (durationMs: number) => void;
}

export interface AgentDatabaseHostStartFailure {
  reason: string;
  output: string;
  consecutiveFailures: number;
  retryAfterMs: number;
}

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

const WRITE_STOPPED_MESSAGE =
  "That statement ran longer than allowed and was stopped. It may have been saved before it stopped: read the rows it writes before you run it again. Narrow the query, add an index, or work in smaller batches.";

const EXITED_MESSAGE = "The database process stopped unexpectedly. Try the call again.";

const NOT_STARTED_MESSAGE = "The database process did not start. Nothing was run. Try the call again.";

const UNAVAILABLE_MESSAGE =
  "The database process could not start, so shared tables are not available now. Nothing was run. Do not retry now: keep these records in a file in your workspace, and try shared tables again later.";

export class AgentDatabaseSupervisor {
  readonly #spawnHost: () => AgentDatabaseHostProcess;
  readonly #statementDeadlineMs: number;
  readonly #hostStartDeadlineMs: number;
  readonly #queueWaitMs: number;
  readonly #onStatementSettled: ((durationMs: number) => void) | undefined;
  readonly #hostStartRetryDelayMs: number;
  readonly #onHostStartFailed: ((failure: AgentDatabaseHostStartFailure) => void) | undefined;
  readonly #queue: PendingRequest[] = [];

  #host: AgentDatabaseHostProcess | null = null;
  #hostReady = false;
  #inFlight: PendingRequest | null = null;
  #sentAt = 0;
  #deadline: NodeJS.Timeout | null = null;
  #generation = 0;
  #nextId = 1;
  #disposed = false;
  #startFailures = 0;
  #retryNotBefore = 0;

  constructor(options: AgentDatabaseSupervisorOptions) {
    this.#spawnHost = options.spawnHost;
    this.#statementDeadlineMs = options.statementDeadlineMs ?? AGENT_DATABASE_LIMITS.statementDeadlineMs;
    this.#hostStartDeadlineMs = options.hostStartDeadlineMs ?? AGENT_DATABASE_LIMITS.hostStartDeadlineMs;
    this.#queueWaitMs = options.queueWaitMs ?? AGENT_DATABASE_LIMITS.queueWaitMs;
    this.#onStatementSettled = options.onStatementSettled;
    this.#hostStartRetryDelayMs = options.hostStartRetryDelayMs ?? AGENT_DATABASE_LIMITS.hostStartRetryDelayMs;
    this.#onHostStartFailed = options.onHostStartFailed;
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
      return Effect.sync(() => {
        const index = this.#queue.indexOf(entry);
        if (index !== -1) this.#queue.splice(index, 1);
      });
    });
  }

  prewarm(): void {
    if (this.#disposed || this.#waitingToRetry()) return;
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
    if (this.#waitingToRetry()) {
      for (const entry of this.#queue.splice(0)) entry.settle(failed("internal", UNAVAILABLE_MESSAGE));
      return;
    }
    const host = this.#ensureHost();
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
    host.onExit((code) => this.#exited(generation, code));
    this.#host = host;
    this.#hostReady = false;
    this.#deadline = setTimeout(
      () => this.#abandonStart(generation, `did not report ready in ${this.#hostStartDeadlineMs} ms`),
      this.#hostStartDeadlineMs,
    );
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
    this.#startFailures = 0;
    this.#retryNotBefore = 0;
    this.#pump();
  }

  #exited(generation: number, code: number | null): void {
    if (this.#hostReady) this.#discardHost(generation, EXITED_MESSAGE);
    else this.#abandonStart(generation, `exited with code ${code ?? "unknown"} before it reported ready`);
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

  #abandonStart(generation: number, reason: string): void {
    if (generation !== this.#generation || this.#disposed) return;
    const output = this.#host?.recentOutput?.() ?? "";
    this.#endHost();
    this.#startFailures += 1;
    const retryAfterMs =
      this.#startFailures < 2
        ? 0
        : Math.min(
            this.#hostStartRetryDelayMs * 2 ** (this.#startFailures - 2),
            AGENT_DATABASE_LIMITS.maxHostStartRetryDelayMs,
          );
    this.#retryNotBefore = Date.now() + retryAfterMs;
    this.#onHostStartFailed?.({ reason, output, consecutiveFailures: this.#startFailures, retryAfterMs });
    const message = retryAfterMs === 0 ? NOT_STARTED_MESSAGE : UNAVAILABLE_MESSAGE;
    const waiting = this.#queue.splice(0);
    for (const entry of waiting) entry.settle(failed("internal", message));
  }

  #waitingToRetry(): boolean {
    return this.#host === null && Date.now() < this.#retryNotBefore;
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
