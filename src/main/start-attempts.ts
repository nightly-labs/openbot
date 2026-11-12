import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import { countCrashDumps } from "./run-marker";

/**
 * A small file in the user data folder that counts the starts of one app version that did not
 * finish. A start finishes when the main window has loaded and the database is open. After
 * `START_FAILURE_LIMIT` failed starts in a row, the desktop shows the recovery window before the
 * next start (`start-recovery-window.ts`).
 *
 * Only a failure counts: the start reported an error, the main process had an uncaught exception
 * before the start finished, or the process crashed and Crashpad wrote a dump. These do not count,
 * and they do not reset the count either:
 * - a quit during the start (the user, a signal, a session end, an update install),
 * - an OS shutdown or restart, and a power loss (the computer started again after the attempt),
 * - a kill from outside that cannot be caught (SIGKILL, Force Quit, Task Manager): no dump is written.
 *
 * All writes are synchronous for the same reasons as `run-marker.ts`. The file has times, versions
 * and fixed words only, and it never leaves the computer except in a diagnostics export.
 */

export const START_ATTEMPTS_FILE = "openbot-start-attempts-v1.json";
/** The failed starts in a row of one version before the recovery window shows. */
const START_FAILURE_LIMIT = 3;

const StartFailure = Schema.Literals(["error", "exception", "crash"]);
type StartFailure = typeof StartFailure.Type;

const StartAttemptsRecord = Schema.Struct({
  version: Schema.Literal(1),
  appVersion: Schema.String,
  consecutiveFailures: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  lastFailure: Schema.NullOr(StartFailure),
  /** The last version that finished a start, for the link to its download page. */
  lastGoodVersion: Schema.NullOr(Schema.String),
  /** The start that has not finished yet. `null` after a finished start. */
  attempt: Schema.NullOr(
    Schema.Struct({
      startedAt: Schema.Finite,
      state: Schema.Literals(["starting", "failed", "quitting"]),
      failure: Schema.NullOr(StartFailure),
      osShutdown: Schema.Boolean,
    }),
  ),
});
type StartAttemptsRecord = typeof StartAttemptsRecord.Type;
const decodeStartAttempts = Schema.decodeUnknownOption(StartAttemptsRecord);

/** How the previous attempt ended, for the main log and the diagnostics export. */
type PreviousStartOutcome =
  | "none"
  | "finished"
  | "failed"
  | "crashed"
  | "quit"
  | "os_restart"
  | "stopped"
  | "other_version";

interface StartAttemptsOptions {
  userDataPath: string;
  /** `app.getPath("crashDumps")`. Only file names and times are read there, never a dump. */
  crashDumpsPath: string;
  appVersion: string;
  now: number;
  /** When the operating system started, in epoch milliseconds. */
  bootedAt: number;
}

/** What the recovery window and the diagnostics export show. Fixed words, counts and versions only. */
export interface StartAttemptsSummary {
  appVersion: string;
  consecutiveFailures: number;
  lastFailure: StartFailure | null;
  lastGoodVersion: string | null;
  previousOutcome: PreviousStartOutcome;
}

class StartAttemptsFailure extends Schema.TaggedError<StartAttemptsFailure>()("StartAttemptsFailure", {
  cause: Schema.Defect(),
}) {}

export class StartAttempts {
  readonly #path: string;
  readonly #previousOutcome: PreviousStartOutcome;
  #record: StartAttemptsRecord;

  private constructor(path: string, record: StartAttemptsRecord, previousOutcome: PreviousStartOutcome) {
    this.#path = path;
    this.#record = record;
    this.#previousOutcome = previousOutcome;
  }

  /**
   * Reads how the previous start ended, counts it, and records this start. Call it only in the
   * process that holds the single-instance lock, before the database opens.
   */
  static begin(options: StartAttemptsOptions): StartAttempts {
    const path = join(options.userDataPath, START_ATTEMPTS_FILE);
    const read = Effect.runSync(
      Effect.try({
        try: () => decodeStartAttempts(JSON.parse(readFileSync(path, "utf8"))),
        catch: (cause) => new StartAttemptsFailure({ cause }),
      }).pipe(Effect.orElseSucceed(() => Option.none<StartAttemptsRecord>())),
    );
    const previous = Option.getOrNull(read);
    const previousOutcome = previous ? classify(previous, options) : "none";
    const counts = previousOutcome === "failed" || previousOutcome === "crashed";
    const sameVersion = previous?.appVersion === options.appVersion;
    const previousFailure = previous?.attempt?.failure ?? (previousOutcome === "crashed" ? "crash" : null);
    const attempts = new StartAttempts(
      path,
      {
        version: 1,
        appVersion: options.appVersion,
        // A new version starts from zero. A quit, a kill or an OS restart keeps the count.
        consecutiveFailures: sameVersion && previous ? previous.consecutiveFailures + (counts ? 1 : 0) : 0,
        lastFailure: sameVersion && counts ? previousFailure : sameVersion ? (previous?.lastFailure ?? null) : null,
        lastGoodVersion: previous?.lastGoodVersion ?? null,
        attempt: { startedAt: options.now, state: "starting", failure: null, osShutdown: false },
      },
      sameVersion || !previous ? previousOutcome : "other_version",
    );
    attempts.#write();
    return attempts;
  }

  /** True when the recovery window must show before this start continues. */
  get loopDetected(): boolean {
    return this.#record.consecutiveFailures >= START_FAILURE_LIMIT;
  }

  summary(): StartAttemptsSummary {
    return {
      appVersion: this.#record.appVersion,
      consecutiveFailures: this.#record.consecutiveFailures,
      lastFailure: this.#record.lastFailure,
      lastGoodVersion: this.#record.lastGoodVersion,
      previousOutcome: this.#previousOutcome,
    };
  }

  /**
   * The start failed. The first failure stays, and a later quit does not replace it. After a quit
   * started, an error of the teardown is not a failed start.
   */
  failed(failure: Exclude<StartFailure, "crash">): void {
    const attempt = this.#record.attempt;
    if (attempt?.state !== "starting") return;
    this.#update({ attempt: { ...attempt, state: "failed", failure } });
  }

  /** A quit started before the start finished. It does not count as a failure. */
  quitting(): void {
    const attempt = this.#record.attempt;
    if (attempt?.state !== "starting") return;
    this.#update({ attempt: { ...attempt, state: "quitting" } });
  }

  /** The operating system said that it shuts down or restarts. The attempt then does not count. */
  osShutdown(): void {
    const attempt = this.#record.attempt;
    if (!attempt) return;
    this.#update({ attempt: { ...attempt, osShutdown: true } });
  }

  /** The main window loaded and the database is open. This resets the count. */
  finished(): void {
    if (!this.#record.attempt) return;
    this.#update({
      consecutiveFailures: 0,
      lastFailure: null,
      lastGoodVersion: this.#record.appVersion,
      attempt: null,
    });
  }

  #update(change: Partial<StartAttemptsRecord>): void {
    this.#record = { ...this.#record, ...change };
    this.#write();
  }

  /** A failed write only loses this sign. The rename replaces the file in one step. */
  #write(): void {
    const content = `${JSON.stringify(this.#record)}\n`;
    const temporaryPath = `${this.#path}.tmp`;
    Effect.runSync(
      Effect.try({
        try: () => {
          writeFileSync(temporaryPath, content, { mode: 0o600 });
          renameSync(temporaryPath, this.#path);
        },
        catch: (cause) => new StartAttemptsFailure({ cause }),
      }).pipe(Effect.ignore),
    );
  }
}

function classify(record: StartAttemptsRecord, options: StartAttemptsOptions): Exclude<PreviousStartOutcome, "none"> {
  const attempt = record.attempt;
  if (!attempt) return "finished";
  if (attempt.state === "failed") return "failed";
  if (attempt.state === "quitting") return "quit";
  // The process ended in `starting` with no quit. Crashpad writes a dump for a crash, but not for a
  // kill from outside. A restart after the crash does not remove the crash: users often restart
  // when an app does not open.
  if (countCrashDumps(options.crashDumpsPath, attempt.startedAt, options.now) > 0) return "crashed";
  // With no sign of a failure, an OS shutdown, a restart or a power loss stopped a start that can be healthy.
  if (attempt.osShutdown || options.bootedAt > attempt.startedAt) return "os_restart";
  return "stopped";
}

/** The start failure that `scripts/start-recovery-e2e.ts` forces. */
type ForcedStartFailure = "crash" | "hang";

/**
 * Reads and removes `OPENBOT_E2E_FORCE_START_FAILURE`, so no child process inherits it. A packaged
 * app ignores it: only the E2E test of a development build sets it.
 */
export function takeForcedStartFailure(environment: NodeJS.ProcessEnv, isPackaged: boolean): ForcedStartFailure | null {
  const value = environment.OPENBOT_E2E_FORCE_START_FAILURE;
  delete environment.OPENBOT_E2E_FORCE_START_FAILURE;
  if (isPackaged) return null;
  return value === "crash" || value === "hang" ? value : null;
}
