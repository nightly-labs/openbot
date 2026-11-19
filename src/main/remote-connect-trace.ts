import { quantize } from "./resource-summary";
import type { TraceSpan } from "./trace-file";

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

export interface RemoteConnectSummary {
  readonly outcome: "connected" | "failed";
  readonly connection: "first" | "reconnect";
  readonly session?: "new" | "stored" | "reused";
  readonly lastPhase: RemoteConnectPhase | "start";
  readonly phases: Readonly<Partial<Record<RemoteConnectPhase, number>>>;
  readonly totalMs: number;
  readonly failedAttempts: number;
  readonly waitMs: number;
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

interface Streak {
  readonly startedAt: number;
  failures: number;
}

const SESSION_KINDS = { ok: "new", stored: "stored", reused: "reused" } as const;

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

  begin(hostId: string): number {
    const startedAt = performance.now();
    this.#nextAttempt += 1;
    const id = this.#nextAttempt;
    this.#attempts.set(hostId, { id, startedAt, phases: {}, lastPhase: "start" });
    if (!this.#streaks.has(hostId)) this.#streaks.set(hostId, { startedAt, failures: 0 });
    this.#write("start", startedAt, "ok");
    return id;
  }

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

  hostedStart(hostId: string, waitedMs: number): void {
    const attempt = this.#attempts.get(hostId);
    if (attempt) attempt.hostedStartWaitMs = waitedMs;
  }

  fail(hostId: string, attemptId: number, outcome: "error" | "cancelled"): void {
    const attempt = this.#attempts.get(hostId);
    if (attempt?.id !== attemptId) return;
    this.#attempts.delete(hostId);
    const now = performance.now();
    this.#write("failed", now - attempt.startedAt, outcome);
    const streak = this.#streaks.get(hostId);
    if (outcome === "cancelled" || !streak) {
      this.#streaks.delete(hostId);
      return;
    }
    if (streak.failures === 0) this.#summary(hostId, attempt, "failed", now, streak);
    streak.failures += 1;
  }

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
