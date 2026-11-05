import { quantize } from "./resource-summary";
import type { TraceSpan } from "./trace-file";

/**
 * The steps of one connection to a remote WebRTC host, in the order they normally finish. Each one
 * is written to the local trace once per attempt, so a slow start can be split into the step that
 * took the time.
 */
export const REMOTE_CONNECT_PHASES = [
  "session",
  "ticket",
  "bridge",
  "signal-socket",
  "signal",
  "channels",
  "auth",
  "compatibility",
  "first-request",
] as const;
export type RemoteConnectPhase = (typeof REMOTE_CONNECT_PHASES)[number];

/**
 * The analytics summary of a connection: phase names, times and counts only, never a host. It goes when
 * an attempt makes its first request, and for the first failed attempt after a connection or a cancel.
 * Later failed attempts are counted in the next summary, so a host that stays away sends one failure.
 */
export interface RemoteConnectSummary {
  readonly outcome: "connected" | "failed";
  /** `first`: no earlier attempt to this host connected in this process. */
  readonly connection: "first" | "reconnect";
  readonly session?: "new" | "stored" | "reused";
  /** The last phase that finished. `start`: none did. */
  readonly lastPhase: RemoteConnectPhase | "start";
  /** Milliseconds from the start of the attempt to the end of each phase that finished. */
  readonly phases: Readonly<Partial<Record<RemoteConnectPhase, number>>>;
  readonly totalMs: number;
  /** The failed attempts since the last connection or cancel, before this attempt. */
  readonly failedAttempts: number;
  /** Milliseconds from the first of those attempts. The same as `totalMs` when none failed. */
  readonly waitMs: number;
  /** Milliseconds from the hosted start request to the connection. */
  readonly hostedStartWaitMs?: number;
  readonly firstRequest?: "ok" | "error";
}

interface Attempt {
  readonly id: number;
  readonly startedAt: number;
  readonly phases: Partial<Record<RemoteConnectPhase, number>>;
  lastPhase: RemoteConnectPhase | "start";
  session?: "new" | "stored" | "reused";
  hostedStartWaitMs?: number;
}

/** The failed attempts to one host since its last connection or cancel. */
interface Streak {
  readonly startedAt: number;
  failures: number;
}

const SESSION_KINDS = { ok: "new", stored: "stored", reused: "reused" } as const;

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
  readonly #summarize: (summary: RemoteConnectSummary) => void;
  readonly #attempts = new Map<string, Attempt>();
  readonly #streaks = new Map<string, Streak>();
  readonly #connected = new Set<string>();
  #nextAttempt = 0;

  constructor(record: (span: TraceSpan) => void, summarize: (summary: RemoteConnectSummary) => void = () => {}) {
    this.#record = record;
    this.#summarize = summarize;
  }

  /** Starts an attempt and returns its id. A newer attempt to the same host replaces it. */
  begin(hostId: string): number {
    const startedAt = performance.now();
    this.#nextAttempt += 1;
    const id = this.#nextAttempt;
    this.#attempts.set(hostId, { id, startedAt, phases: {}, lastPhase: "start" });
    if (!this.#streaks.has(hostId)) this.#streaks.set(hostId, { startedAt, failures: 0 });
    this.#write("start", startedAt, "ok");
    return id;
  }

  /** Records a phase of the current attempt. A phase without an attempt, or a repeated one, is skipped. */
  mark(hostId: string, phase: RemoteConnectPhase, outcome = "ok"): void {
    const attempt = this.#attempts.get(hostId);
    if (!attempt || attempt.phases[phase] !== undefined) return;
    const now = performance.now();
    attempt.phases[phase] = now - attempt.startedAt;
    attempt.lastPhase = phase;
    if (phase === "session" && (outcome === "ok" || outcome === "stored" || outcome === "reused"))
      attempt.session = SESSION_KINDS[outcome];
    this.#write(phase, now - attempt.startedAt, outcome);
    if (phase !== "first-request") return;
    this.#attempts.delete(hostId);
    const streak = this.#streaks.get(hostId);
    this.#streaks.delete(hostId);
    this.#summary(hostId, attempt, "connected", now, streak, outcome === "ok" ? "ok" : "error");
    this.#connected.add(hostId);
  }

  /** The client waited this long for a hosted server to start before this attempt connected. */
  hostedStart(hostId: string, waitedMs: number): void {
    const attempt = this.#attempts.get(hostId);
    if (attempt) attempt.hostedStartWaitMs = waitedMs;
  }

  /**
   * The attempt ended before its first request. An old attempt can end after a newer one began: it
   * then changes nothing, because the newer attempt replaced it.
   */
  fail(hostId: string, attemptId: number, outcome: "error" | "cancelled"): void {
    const attempt = this.#attempts.get(hostId);
    if (attempt?.id !== attemptId) return;
    this.#attempts.delete(hostId);
    const now = performance.now();
    this.#write("failed", now - attempt.startedAt, outcome);
    const streak = this.#streaks.get(hostId);
    // A cancel is the user's or the app's choice: the next attempt starts a new wait.
    if (outcome === "cancelled" || !streak) {
      this.#streaks.delete(hostId);
      return;
    }
    if (streak.failures === 0) this.#summary(hostId, attempt, "failed", now, streak);
    streak.failures += 1;
  }

  /** The read of the account's host list that pins host keys at startup. */
  directory(durationMs: number, outcome: "ok" | "error"): void {
    this.#write("directory", durationMs, outcome);
  }

  #summary(
    hostId: string,
    attempt: Attempt,
    outcome: RemoteConnectSummary["outcome"],
    now: number,
    streak: Streak | undefined,
    firstRequest?: RemoteConnectSummary["firstRequest"],
  ): void {
    const phases: Partial<Record<RemoteConnectPhase, number>> = {};
    for (const phase of REMOTE_CONNECT_PHASES) {
      const ms = attempt.phases[phase];
      if (ms !== undefined) phases[phase] = quantize(ms);
    }
    const failedAttempts = outcome === "connected" ? (streak?.failures ?? 0) : 0;
    this.#summarize({
      outcome,
      connection: this.#connected.has(hostId) ? "reconnect" : "first",
      ...(attempt.session ? { session: attempt.session } : {}),
      lastPhase: attempt.lastPhase,
      phases,
      totalMs: quantize(now - attempt.startedAt),
      failedAttempts,
      waitMs: quantize(now - (failedAttempts > 0 && streak ? streak.startedAt : attempt.startedAt)),
      ...(attempt.hostedStartWaitMs === undefined ? {} : { hostedStartWaitMs: quantize(attempt.hostedStartWaitMs) }),
      ...(firstRequest ? { firstRequest } : {}),
    });
  }

  #write(name: string, durationMs: number, outcome: string): void {
    this.#record({ kind: "connect", name: `remote-connect:${name}`, durationMs, outcome });
  }
}
