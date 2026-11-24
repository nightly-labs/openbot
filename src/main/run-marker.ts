import { type Dirent, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";

export const RUN_MARKER_FILE = "openbot-run-marker-v1.json";
const RUN_HEARTBEAT_MS = 60_000;
const MAX_CRASH_DUMPS = 10;
const CRASH_DUMP_DEPTH = 3;

const UPTIME_CLASSES = [
  ["lt1m", 60_000],
  ["lt10m", 10 * 60_000],
  ["lt1h", 60 * 60_000],
  ["lt8h", 8 * 60 * 60_000],
  ["lt24h", 24 * 60 * 60_000],
] as const;
export const UNCLEAN_EXIT_ENUMS = {
  phase: ["running", "quitting", "quit_timeout"],
  uptime_class: [...UPTIME_CLASSES.map(([name]) => name), "ge24h"],
  host_kind: ["desktop", "server"],
} as const;

const CLEAN_QUIT_REASONS: ReadonlySet<string> = new Set(["update", "session_end"]);

const RunMarkerRecord = Schema.Struct({
  version: Schema.Literal(1),
  appVersion: Schema.String,
  startedAt: Schema.Finite,
  heartbeatAt: Schema.Finite,
  state: Schema.Literals(["running", "quitting", "quit_timeout", "clean"]),
  quitReason: Schema.NullOr(Schema.String),
  sleeping: Schema.Boolean,
  slept: Schema.Boolean,
  osShutdown: Schema.Boolean,
});
type RunMarkerRecord = typeof RunMarkerRecord.Type;
const decodeRunMarker = Schema.decodeUnknownOption(RunMarkerRecord);

export interface UncleanExitProperties {
  phase: (typeof UNCLEAN_EXIT_ENUMS.phase)[number];
  previous_app_version: string;
  uptime_class: (typeof UNCLEAN_EXIT_ENUMS.uptime_class)[number];
  crash_dump_count: number;
  slept: boolean;
  ended_asleep: boolean;
  os_restarted: boolean;
  host_kind: (typeof UNCLEAN_EXIT_ENUMS.host_kind)[number];
}

export interface RunMarkerOptions {
  userDataPath: string;
  crashDumpsPath: string;
  appVersion: string;
  server: boolean;
  now: number;
  bootedAt: number;
}

class RunMarkerFailure extends Schema.TaggedError<RunMarkerFailure>()("RunMarkerFailure", {
  cause: Schema.Defect(),
}) {}

export class RunMarker {
  readonly #path: string;
  #record: RunMarkerRecord;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #sequence = 0;
  #written = 0;
  #writing = false;

  private constructor(path: string, record: RunMarkerRecord) {
    this.#path = path;
    this.#record = record;
  }

  static start(options: RunMarkerOptions): { marker: RunMarker; previous: UncleanExitProperties | null } {
    const path = join(options.userDataPath, RUN_MARKER_FILE);
    const read = Effect.runSync(
      Effect.try({
        try: () => decodeRunMarker(JSON.parse(readFileSync(path, "utf8"))),
        catch: (cause) => new RunMarkerFailure({ cause }),
      }).pipe(Effect.orElseSucceed(() => Option.none<RunMarkerRecord>())),
    );
    const previous = Option.isSome(read) ? uncleanExit(read.value, options) : null;
    const marker = new RunMarker(path, {
      version: 1,
      appVersion: options.appVersion,
      startedAt: options.now,
      heartbeatAt: options.now,
      state: "running",
      quitReason: null,
      sleeping: false,
      slept: false,
      osShutdown: false,
    });
    marker.#writeNow();
    marker.#heartbeat = setInterval(() => marker.#updateLater({}), RUN_HEARTBEAT_MS);
    marker.#heartbeat.unref();
    return { marker, previous };
  }

  suspend(): void {
    this.#update({ sleeping: true, slept: true });
  }

  resume(): void {
    this.#updateLater({ sleeping: false });
  }

  osShutdown(): void {
    this.#update({ osShutdown: true });
  }

  quitting(reason: string): void {
    if (this.#record.state !== "running") return;
    this.#stopHeartbeat();
    this.#update({ state: "quitting", quitReason: reason });
  }

  quitTimedOut(): void {
    if (this.#record.state === "clean") return;
    this.#stopHeartbeat();
    this.#update({ state: "quit_timeout" });
  }

  clean(): void {
    this.#stopHeartbeat();
    this.#update({ state: "clean" });
  }

  get #pendingPath(): string {
    return `${this.#path}.pending`;
  }

  #stopHeartbeat(): void {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }

  #update(change: Partial<RunMarkerRecord>): void {
    if (this.#change(change)) this.#writeNow();
  }

  #updateLater(change: Partial<RunMarkerRecord>): void {
    if (this.#change(change)) this.#writeLater();
  }

  #change(change: Partial<RunMarkerRecord>): boolean {
    if (this.#record.state === "clean") return false;
    this.#record = { ...this.#record, ...change, heartbeatAt: Date.now() };
    this.#sequence += 1;
    return true;
  }

  #writeNow(): void {
    this.#written = this.#sequence;
    const content = recordContent(this.#record);
    const temporaryPath = `${this.#path}.tmp`;
    Effect.runSync(
      Effect.try({
        try: () => {
          if (this.#writing) rmSync(this.#pendingPath, { force: true });
          writeFileSync(temporaryPath, content, { mode: 0o600 });
          renameSync(temporaryPath, this.#path);
        },
        catch: (cause) => new RunMarkerFailure({ cause }),
      }).pipe(Effect.ignore),
    );
  }

  #writeLater(): void {
    if (this.#writing) return;
    this.#writing = true;
    Effect.runFork(
      this.#flush().pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.#writing = false;
            if (this.#written < this.#sequence) this.#writeLater();
          }),
        ),
      ),
    );
  }

  readonly #flush = Effect.fn("RunMarker.flush")(function* (this: RunMarker) {
    while (this.#written < this.#sequence) {
      const sequence = this.#sequence;
      const replaced = yield* this.#replace(sequence, recordContent(this.#record)).pipe(
        Effect.orElseSucceed(() => false),
      );
      yield* Effect.sync(() => {
        if (replaced && this.#written >= sequence) this.#writeNow();
        this.#written = Math.max(this.#written, sequence);
      });
    }
  });

  readonly #replace = Effect.fn("RunMarker.replace")(function* (this: RunMarker, sequence: number, content: string) {
    const pendingPath = this.#pendingPath;
    yield* Effect.tryPromise({
      try: () => writeFile(pendingPath, content, { mode: 0o600 }),
      catch: (cause) => new RunMarkerFailure({ cause }),
    });
    if (this.#written >= sequence) {
      yield* Effect.promise(() => rm(pendingPath, { force: true }).catch(() => undefined));
      return false;
    }
    yield* Effect.tryPromise({
      try: () => rename(pendingPath, this.#path),
      catch: (cause) => new RunMarkerFailure({ cause }),
    });
    return true;
  });
}

function recordContent(record: RunMarkerRecord): string {
  return `${JSON.stringify(record)}\n`;
}

function uncleanExit(record: RunMarkerRecord, options: RunMarkerOptions): UncleanExitProperties | null {
  if (record.state === "clean" || record.osShutdown) return null;
  if (record.state === "quitting" && record.quitReason !== null && CLEAN_QUIT_REASONS.has(record.quitReason))
    return null;
  const uptime = Math.max(0, record.heartbeatAt - record.startedAt);
  return {
    phase: record.state,
    previous_app_version: record.appVersion,
    uptime_class: UPTIME_CLASSES.find(([, limit]) => uptime < limit)?.[0] ?? "ge24h",
    crash_dump_count: Math.min(
      MAX_CRASH_DUMPS,
      countCrashDumps(options.crashDumpsPath, record.heartbeatAt, options.now),
    ),
    slept: record.slept,
    ended_asleep: record.sleeping,
    os_restarted: options.bootedAt > record.heartbeatAt,
    host_kind: options.server ? "server" : "desktop",
  };
}

export function countCrashDumps(directory: string, from: number, to: number, depth = 0): number {
  if (depth >= CRASH_DUMP_DEPTH) return 0;
  const entries = Effect.runSync(
    Effect.try({
      try: () => readdirSync(directory, { withFileTypes: true }),
      catch: (cause) => new RunMarkerFailure({ cause }),
    }).pipe(Effect.orElseSucceed((): Dirent[] => [])),
  );
  let count = 0;
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) count += countCrashDumps(path, from, to, depth + 1);
    else if (entry.isFile() && entry.name.endsWith(".dmp")) {
      const modifiedAt = Effect.runSync(
        Effect.try({
          try: () => statSync(path).mtimeMs,
          catch: (cause) => new RunMarkerFailure({ cause }),
        }).pipe(Effect.orElseSucceed(() => Number.NaN)),
      );
      if (modifiedAt >= from && modifiedAt < to) count += 1;
    }
  }
  return count;
}
