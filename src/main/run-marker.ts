import { type Dirent, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";

/**
 * A small file in the user data folder that tells the next start how this run ended. It is written
 * at the start, once a minute while the run is alive, at sleep and wake, when a quit starts and when
 * the teardown is done. A run that left it in `running` or `quitting` ended without a clean quit: a
 * crash, a force quit, a kill that cannot be caught, or a power loss.
 *
 * The file has times, the app version and a few states only. It never leaves the computer; the next
 * start makes one `system_unclean_exit` event from it (`ANALYTICS.md`).
 *
 * All writes are synchronous: the quit writes must land before the process ends, and an async write
 * that lands late must not replace a later state. Each write is about 200 bytes.
 */

export const RUN_MARKER_FILE = "openbot-run-marker-v1.json";
/** How often a live run writes its last sign of life. */
const RUN_HEARTBEAT_MS = 60_000;
/** More dumps than this are sent as this count. */
const MAX_CRASH_DUMPS = 10;
/** Crashpad keeps reports in `new`, `pending` and `completed`, or one level deeper on Linux. */
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

/**
 * Quits that end the run although the teardown can stop before it is done: an update install hands
 * the process to the installer, and Windows ends the process a few seconds after a session end.
 */
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

/** The properties of one `system_unclean_exit` event. Fixed names, times and counts only. */
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
  /** `app.getPath("crashDumps")`. Only file names and times are read there, never a dump. */
  crashDumpsPath: string;
  appVersion: string;
  server: boolean;
  now: number;
  /** When the operating system started, in epoch milliseconds. */
  bootedAt: number;
}

class RunMarkerFailure extends Schema.TaggedError<RunMarkerFailure>()("RunMarkerFailure", {
  cause: Schema.Defect(),
}) {}

export class RunMarker {
  readonly #path: string;
  #record: RunMarkerRecord;
  #heartbeat: ReturnType<typeof setInterval> | null = null;

  private constructor(path: string, record: RunMarkerRecord) {
    this.#path = path;
    this.#record = record;
  }

  /**
   * Reads how the previous run ended, then marks this run as running. Call it only in the process
   * that holds the single-instance lock. `previous` is null after a clean quit, an update, an OS
   * shutdown, or when there is no readable file.
   */
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
    marker.#write();
    marker.#heartbeat = setInterval(() => marker.#update({}), RUN_HEARTBEAT_MS);
    marker.#heartbeat.unref();
    return { marker, previous };
  }

  suspend(): void {
    this.#update({ sleeping: true, slept: true });
  }

  resume(): void {
    this.#update({ sleeping: false });
  }

  /** The operating system said that it shuts down or restarts. The run then counts as clean. */
  osShutdown(): void {
    this.#update({ osShutdown: true });
  }

  /** A quit started. The first reason stays. */
  quitting(reason: string): void {
    if (this.#record.state !== "running") return;
    this.#stopHeartbeat();
    this.#update({ state: "quitting", quitReason: reason });
  }

  /** The teardown did not end within its deadline, and OpenBot exits itself. */
  quitTimedOut(): void {
    if (this.#record.state === "clean") return;
    this.#stopHeartbeat();
    this.#update({ state: "quit_timeout" });
  }

  /** The teardown is done. */
  clean(): void {
    this.#stopHeartbeat();
    this.#update({ state: "clean" });
  }

  #stopHeartbeat(): void {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }

  #update(change: Partial<RunMarkerRecord>): void {
    if (this.#record.state === "clean") return;
    this.#record = { ...this.#record, ...change, heartbeatAt: Date.now() };
    this.#write();
  }

  /**
   * A failed write only loses this sign: the next start then reads an older state or nothing. The
   * rename replaces the file in one step, so a kill during the write never leaves a torn marker.
   */
  #write(): void {
    const content = `${JSON.stringify(this.#record)}\n`;
    const temporaryPath = `${this.#path}.tmp`;
    Effect.runSync(
      Effect.try({
        try: () => {
          writeFileSync(temporaryPath, content, { mode: 0o600 });
          renameSync(temporaryPath, this.#path);
        },
        catch: (cause) => new RunMarkerFailure({ cause }),
      }).pipe(Effect.ignore),
    );
  }
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
    // A dump of the main process is written after its last sign of life. A renderer or GPU crash in
    // the last minute of the run counts too.
    crash_dump_count: Math.min(
      MAX_CRASH_DUMPS,
      countCrashDumps(options.crashDumpsPath, record.heartbeatAt, options.now),
    ),
    slept: record.slept,
    ended_asleep: record.sleeping,
    // The computer started again after the run's last sign of life: a power loss, a forced restart,
    // or an end of the run and then a restart.
    os_restarted: options.bootedAt > record.heartbeatAt,
    host_kind: options.server ? "server" : "desktop",
  };
}

/** Counts `.dmp` files with a time in `[from, to)`. Reads names and times only. */
function countCrashDumps(directory: string, from: number, to: number, depth = 0): number {
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
