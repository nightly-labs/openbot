import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isNewerRelease } from "@openbot/contracts/release-version";
import { Effect, Option, Schema } from "effect";
import { countCrashDumps } from "./run-marker";

export const START_ATTEMPTS_FILE = "openbot-start-attempts-v1.json";
const START_FAILURE_LIMIT = 3;

const StartFailure = Schema.Literals(["error", "exception", "crash"]);
type StartFailure = typeof StartFailure.Type;

const StartAttemptsRecord = Schema.Struct({
  version: Schema.Literal(1),
  appVersion: Schema.String,
  consecutiveFailures: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  lastFailure: Schema.NullOr(StartFailure),
  lastGoodVersion: Schema.NullOr(Schema.String),
  lastGoodSchemaVersion: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  loopVersion: Schema.optionalKey(Schema.NullOr(Schema.String)),
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
  crashDumpsPath: string;
  appVersion: string;
  schemaVersion: number;
  now: number;
  bootedAt: number;
}

export interface StartAttemptsSummary {
  appVersion: string;
  consecutiveFailures: number;
  lastFailure: StartFailure | null;
  lastGoodVersion: string | null;
  lastGoodSchemaVersion: number | null;
  loopVersion: string | null;
  previousOutcome: PreviousStartOutcome;
}

class StartAttemptsFailure extends Schema.TaggedError<StartAttemptsFailure>()("StartAttemptsFailure", {
  cause: Schema.Defect(),
}) {}

export class StartAttempts {
  readonly #path: string;
  readonly #previousOutcome: PreviousStartOutcome;
  readonly #schemaVersion: number;
  #record: StartAttemptsRecord;

  private constructor(
    path: string,
    record: StartAttemptsRecord,
    previousOutcome: PreviousStartOutcome,
    schemaVersion: number,
  ) {
    this.#path = path;
    this.#record = record;
    this.#previousOutcome = previousOutcome;
    this.#schemaVersion = schemaVersion;
  }

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
    const previousFailures = previous ? previous.consecutiveFailures + (counts ? 1 : 0) : 0;
    const attempts = new StartAttempts(
      path,
      {
        version: 1,
        appVersion: options.appVersion,
        consecutiveFailures: sameVersion ? previousFailures : 0,
        lastFailure: sameVersion && counts ? previousFailure : sameVersion ? (previous?.lastFailure ?? null) : null,
        lastGoodVersion: previous?.lastGoodVersion ?? null,
        lastGoodSchemaVersion: previous?.lastGoodSchemaVersion ?? null,
        loopVersion:
          previous && previousFailures >= START_FAILURE_LIMIT ? previous.appVersion : (previous?.loopVersion ?? null),
        attempt: { startedAt: options.now, state: "starting", failure: null, osShutdown: false },
      },
      sameVersion || !previous ? previousOutcome : "other_version",
      options.schemaVersion,
    );
    attempts.#write();
    return attempts;
  }

  get loopDetected(): boolean {
    return this.#record.consecutiveFailures >= START_FAILURE_LIMIT;
  }

  get failureLimitReached(): boolean {
    return this.#record.attempt?.state === "failed" && this.#record.consecutiveFailures + 1 >= START_FAILURE_LIMIT;
  }

  summary(): StartAttemptsSummary {
    return {
      appVersion: this.#record.appVersion,
      consecutiveFailures: this.#record.consecutiveFailures,
      lastFailure: this.#record.lastFailure,
      lastGoodVersion: this.#record.lastGoodVersion,
      lastGoodSchemaVersion: this.#record.lastGoodSchemaVersion ?? null,
      loopVersion: this.#record.loopVersion ?? null,
      previousOutcome: this.#previousOutcome,
    };
  }

  failed(failure: Exclude<StartFailure, "crash">): void {
    const attempt = this.#record.attempt;
    if (attempt?.state !== "starting") return;
    this.#update({ attempt: { ...attempt, state: "failed", failure } });
  }

  quitting(): void {
    const attempt = this.#record.attempt;
    if (attempt?.state !== "starting") return;
    this.#update({ attempt: { ...attempt, state: "quitting" } });
  }

  osShutdown(): void {
    const attempt = this.#record.attempt;
    if (!attempt) return;
    this.#update({ attempt: { ...attempt, osShutdown: true } });
  }

  finished(): void {
    if (!this.#record.attempt) return;
    const loopVersion = this.#record.loopVersion ?? null;
    this.#update({
      consecutiveFailures: 0,
      lastFailure: null,
      lastGoodVersion: this.#record.appVersion,
      lastGoodSchemaVersion: this.#schemaVersion,
      loopVersion: loopVersion && !isNewerRelease(loopVersion, this.#record.appVersion) ? null : loopVersion,
      attempt: null,
    });
  }

  #update(change: Partial<StartAttemptsRecord>): void {
    this.#record = { ...this.#record, ...change };
    this.#write();
  }

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
  if (countCrashDumps(options.crashDumpsPath, attempt.startedAt, options.now) > 0) return "crashed";
  if (attempt.osShutdown || options.bootedAt > attempt.startedAt) return "os_restart";
  return "stopped";
}

type ForcedStartFailure = "crash" | "hang";

export function takeForcedStartFailure(environment: NodeJS.ProcessEnv, isPackaged: boolean): ForcedStartFailure | null {
  const value = environment.OPENBOT_E2E_FORCE_START_FAILURE;
  delete environment.OPENBOT_E2E_FORCE_START_FAILURE;
  if (isPackaged) return null;
  return value === "crash" || value === "hang" ? value : null;
}

type ForcedRendererStop = "first-load" | "recovery";

export function takeForcedRendererStop(environment: NodeJS.ProcessEnv, isPackaged: boolean): ForcedRendererStop | null {
  const value = environment.OPENBOT_E2E_STOP_RENDERER;
  delete environment.OPENBOT_E2E_STOP_RENDERER;
  if (isPackaged) return null;
  return value === "first-load" || value === "recovery" ? value : null;
}
