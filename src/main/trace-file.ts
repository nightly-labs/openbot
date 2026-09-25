import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { redactValue } from "@openbot/logging";

/**
 * One timed operation. The name is a fixed string - an IPC channel, a turn origin - and the outcome
 * is a status word. A span holds no payload, message, path, URL or identifier, so the file can go
 * into a diagnostics export under the same promise as the rest of it.
 */
export interface TraceSpan {
  kind: "ipc" | "turn";
  name: string;
  durationMs: number;
  outcome: string;
}

/** Counts and durations for one span name, over every line the trace file still holds. */
export interface TraceSummary {
  kind: string;
  name: string;
  count: number;
  outcomes: Record<string, number>;
  p95Ms: number;
  maxMs: number;
}

export interface TraceFileOptions {
  directory: string;
}

const FILE_NAME = "trace.ndjson";
// Two files at most, the current one and `.1`. About 100 bytes a line gives some 40,000 spans.
const MAX_FILE_BYTES = 2 * 1024 * 1024;
// A burst of IPC calls becomes one append rather than one write for each call.
const FLUSH_DELAY_MS = 1_000;
const MAX_PENDING_LINES = 256;
// A turn whose completion never arrives must not keep its start time forever.
const MAX_OPEN_TURNS = 256;

/**
 * Owns the always-on local trace: IPC calls and provider turns as NDJSON lines in the user data
 * directory. It never sends anything. A write failure is dropped, because a trace must not become
 * the failure it would have recorded.
 */
export class TraceFile {
  readonly #directory: string;
  readonly #path: string;
  readonly #openTurns = new Map<string, { startedAt: number; origin: string }>();
  #pending: string[] = [];
  #timer: NodeJS.Timeout | null = null;
  #writes: Promise<void> = Promise.resolve();

  constructor(options: TraceFileOptions) {
    this.#directory = options.directory;
    this.#path = join(options.directory, FILE_NAME);
  }

  record(span: TraceSpan): void {
    const line = redactValue({
      at: new Date().toISOString(),
      kind: span.kind,
      name: span.name,
      durationMs: Math.max(0, Math.round(span.durationMs)),
      outcome: span.outcome,
    });
    this.#pending.push(JSON.stringify(line));
    if (this.#pending.length >= MAX_PENDING_LINES) {
      void this.flush();
      return;
    }
    if (this.#timer) return;
    this.#timer = setTimeout(() => void this.flush(), FLUSH_DELAY_MS);
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
    // A completion often has no origin of its own; the start has it.
    this.record({
      kind: "turn",
      name: event.origin && event.origin !== "unknown" ? event.origin : started.origin,
      durationMs: performance.now() - started.startedAt,
      outcome: event.status,
    });
  }

  /** Writes the pending lines. The returned promise settles after every earlier write. */
  flush(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const lines = this.#pending;
    this.#pending = [];
    if (lines.length === 0) return this.#writes;
    this.#writes = this.#writes.then(() => this.#append(lines)).catch(() => undefined);
    return this.#writes;
  }

  async summarize(): Promise<TraceSummary[]> {
    await this.flush();
    const text = (await Promise.all([`${this.#path}.1`, this.#path].map(readOptional))).join("");
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
  }

  async #append(lines: string[]): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    try {
      if ((await stat(this.#path)).size >= MAX_FILE_BYTES) await rename(this.#path, `${this.#path}.1`);
    } catch {
      // No file yet.
    }
    await appendFile(this.#path, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  }
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

// A crash can cut the last line short, so a line that does not parse is skipped.
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
  if (kind !== "ipc" && kind !== "turn") return null;
  if (typeof name !== "string" || typeof outcome !== "string" || typeof durationMs !== "number") return null;
  return { kind, name, durationMs, outcome };
}
