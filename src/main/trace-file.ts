import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { redactValue } from "@openbot/logging";
import { Effect, Exit, Scope, Semaphore } from "effect";
import { analyticsIO } from "./analytics-effects";

export interface TraceSpan {
  kind: "ipc" | "turn" | "crash" | "connect" | "exit" | "stall";
  name: string;
  durationMs: number;
  outcome: string;
}

export interface TraceFileOptions {
  directory: string;
}

const FILE_NAME = "trace.ndjson";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const FLUSH_DELAY_MS = 1_000;
const MAX_PENDING_LINES = 256;
const MAX_BUFFERED_LINES = 4_096;
const TURN_STATUSES = new Set(["completed", "failed", "interrupted", "cancelled"]);
const MAX_OPEN_TURNS = 256;

export class TraceFile {
  readonly #directory: string;
  readonly #path: string;
  readonly #openTurns = new Map<string, { startedAt: number; origin: string }>();
  #pending: string[] = [];
  #timer: NodeJS.Timeout | null = null;
  #writes = Semaphore.makeUnsafe(1);
  #writingLines = 0;
  readonly #scope = Scope.makeUnsafe();

  constructor(options: TraceFileOptions) {
    this.#directory = options.directory;
    this.#path = join(options.directory, FILE_NAME);
  }

  record(span: TraceSpan): void {
    if (this.#pending.length + this.#writingLines >= MAX_BUFFERED_LINES) return;
    const line = redactValue({
      at: new Date().toISOString(),
      kind: span.kind,
      name: span.name,
      durationMs: Math.max(0, Math.round(span.durationMs)),
      outcome: span.outcome,
    });
    this.#pending.push(JSON.stringify(line));
    if (this.#pending.length >= MAX_PENDING_LINES) {
      this.#flushLater();
      return;
    }
    if (this.#timer) return;
    this.#timer = setTimeout(() => this.#flushLater(), FLUSH_DELAY_MS);
    this.#timer.unref();
  }

  observeAgentEvent(event: AgentEvent): void {
    if (event.type === "turn-started") {
      if (this.#openTurns.size >= MAX_OPEN_TURNS) {
        const oldest = this.#openTurns.keys().next();
        if (!oldest.done) this.#openTurns.delete(oldest.value);
      }
      this.#openTurns.set(event.turnId, { startedAt: performance.now(), origin: event.origin ?? "unknown" });
      return;
    }
    if (event.type !== "turn-completed") return;
    const started = this.#openTurns.get(event.turnId);
    this.#openTurns.delete(event.turnId);
    if (!started) return;
    this.record({
      kind: "turn",
      name: event.origin && event.origin !== "unknown" ? event.origin : started.origin,
      durationMs: performance.now() - started.startedAt,
      outcome: TURN_STATUSES.has(event.status) ? event.status : "other",
    });
  }

  readonly flush = Effect.fn("TraceFile.flush")(function* (this: TraceFile) {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const lines = this.#pending;
    this.#pending = [];
    this.#writingLines += lines.length;
    const file = { directory: this.#directory, path: this.#path, maxBytes: MAX_FILE_BYTES };
    yield* this.#writes
      .withPermit(lines.length ? appendRotatingLines(file, lines).pipe(Effect.ignore) : Effect.void)
      .pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.#writingLines -= lines.length;
          }),
        ),
      );
  }, Effect.uninterruptible);

  readonly close = Effect.fn("TraceFile.close")(function* (this: TraceFile) {
    yield* this.flush();
    yield* Scope.close(this.#scope, Exit.void);
  });

  #flushLater(): void {
    Effect.runFork(Effect.forkIn(this.flush(), this.#scope, { startImmediately: true }));
  }

  readonly summarize = Effect.fn("TraceFile.summarize")(function* (this: TraceFile) {
    yield* this.flush();
    const text = (yield* this.#writes.withPermit(
      Effect.forEach([`${this.#path}.1`, this.#path], readOptional, { concurrency: "unbounded" }),
    )).join("");
    const groups = new Map<
      string,
      { kind: string; name: string; durations: number[]; outcomes: Record<string, number> }
    >();
    for (const line of text.split("\n")) {
      const span = parseLine(line);
      if (!span) continue;
      const key = `${span.kind}\u0000${span.name}`;
      const group = groups.get(key) ?? { kind: span.kind, name: span.name, durations: [], outcomes: {} };
      group.durations.push(span.durationMs);
      group.outcomes[span.outcome] = (group.outcomes[span.outcome] ?? 0) + 1;
      groups.set(key, group);
    }
    return [...groups.values()]
      .map(({ kind, name, durations, outcomes }) => {
        const sorted = durations.sort((left, right) => left - right);
        return {
          kind,
          name,
          count: sorted.length,
          outcomes,
          p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
          maxMs: sorted.at(-1) ?? 0,
        };
      })
      .sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name));
  });
}

export const appendRotatingLines = Effect.fn("TraceFile.appendRotatingLines")(function* (
  file: { directory: string; path: string; maxBytes: number },
  lines: readonly string[],
) {
  yield* analyticsIO(() => mkdir(file.directory, { recursive: true }));
  yield* analyticsIO(() => stat(file.path)).pipe(
    Effect.flatMap((stats) =>
      stats.size >= file.maxBytes ? analyticsIO(() => rename(file.path, `${file.path}.1`)) : Effect.void,
    ),
    Effect.catch(() => Effect.void),
  );
  yield* analyticsIO(() => appendFile(file.path, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 }));
});

const readOptional = Effect.fn("TraceFile.readOptional")((path: string) =>
  analyticsIO(() => readFile(path, "utf8")).pipe(Effect.catch(() => Effect.succeed(""))),
);

function parseLine(line: string): TraceSpan | null {
  if (!line) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isDynamicRecord(parsed)) return null;
  const { kind, name, durationMs, outcome } = parsed;
  if (kind !== "ipc" && kind !== "turn" && kind !== "crash" && kind !== "connect" && kind !== "exit") return null;
  if (typeof name !== "string" || typeof outcome !== "string" || typeof durationMs !== "number") return null;
  return { kind, name, durationMs, outcome };
}
