import type { TraceSpan } from "./trace-file";

/**
 * The steps of one connection to a remote WebRTC host, in the order they normally finish. Each one
 * is written to the local trace once per attempt, so a slow start can be split into the step that
 * took the time.
 */
export type RemoteConnectPhase =
  | "session"
  | "ticket"
  | "bridge"
  | "signal"
  | "channels"
  | "auth"
  | "compatibility"
  | "first-request";

interface Attempt {
  readonly startedAt: number;
  readonly recorded: Set<RemoteConnectPhase>;
}

/**
 * Times the connection to each remote host for the local trace file. A span holds only a fixed phase
 * name, a duration and a status word: never a host, session, ticket, key or address, because the
 * trace goes into a diagnostics export. A host id is only the key of an attempt in memory.
 *
 * `remote-connect:start` has the time since the process started as its duration, so a cold start
 * shows when the first connection began. Every later phase has the time since that start.
 */
export class RemoteConnectTrace {
  readonly #record: (span: TraceSpan) => void;
  readonly #attempts = new Map<string, Attempt>();

  constructor(record: (span: TraceSpan) => void) {
    this.#record = record;
  }

  begin(hostId: string): void {
    this.#attempts.set(hostId, { startedAt: performance.now(), recorded: new Set() });
    this.#write("start", performance.now(), "ok");
  }

  /** Records a phase of the current attempt. A phase without an attempt, or a repeated one, is skipped. */
  mark(hostId: string, phase: RemoteConnectPhase, outcome = "ok"): void {
    const attempt = this.#attempts.get(hostId);
    if (!attempt || attempt.recorded.has(phase)) return;
    attempt.recorded.add(phase);
    this.#write(phase, performance.now() - attempt.startedAt, outcome);
    if (phase === "first-request") this.#attempts.delete(hostId);
  }

  /** The attempt ended before its first request. */
  fail(hostId: string, outcome: "error" | "cancelled"): void {
    const attempt = this.#attempts.get(hostId);
    if (!attempt) return;
    this.#attempts.delete(hostId);
    this.#write("failed", performance.now() - attempt.startedAt, outcome);
  }

  /** The read of the account's host list that pins host keys at startup. */
  directory(durationMs: number, outcome: "ok" | "error"): void {
    this.#write("directory", durationMs, outcome);
  }

  #write(name: string, durationMs: number, outcome: string): void {
    this.#record({ kind: "connect", name: `remote-connect:${name}`, durationMs, outcome });
  }
}
