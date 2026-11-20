import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import { NewerDatabaseError } from "../backend/openbot-database-schema";

export const START_LOOP_EXIT_CODE = 78;
export const START_HALT_FILE = "openbot-start-halt-v1.json";

const StartHaltReason = Schema.Literals(["newer_database", "start_failed"]);
export type StartHaltReason = typeof StartHaltReason.Type;

const StartHaltRecord = Schema.Struct({
  version: Schema.Literal(1),
  reason: StartHaltReason,
  appVersion: Schema.String,
  haltedAt: Schema.Finite,
});
export type StartHaltRecord = typeof StartHaltRecord.Type;
const decodeStartHalt = Schema.decodeUnknownOption(StartHaltRecord);

class StartHaltFileFailure extends Schema.TaggedError<StartHaltFileFailure>()("StartHaltFileFailure", {
  cause: Schema.Defect(),
}) {}

const MAX_CAUSE_DEPTH = 8;

export function startHaltReason(error: unknown): StartHaltReason {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if (current instanceof NewerDatabaseError) return "newer_database";
    current = current.cause;
  }
  return "start_failed";
}

export function takeStartHalt(userDataPath: string): StartHaltRecord | null {
  const path = join(userDataPath, START_HALT_FILE);
  const read = Effect.runSync(
    Effect.try({
      try: () => decodeStartHalt(JSON.parse(readFileSync(path, "utf8"))),
      catch: (cause) => new StartHaltFileFailure({ cause }),
    }).pipe(Effect.orElseSucceed(() => Option.none<StartHaltRecord>())),
  );
  Effect.runSync(
    Effect.try({
      try: () => rmSync(path, { force: true }),
      catch: (cause) => new StartHaltFileFailure({ cause }),
    }).pipe(Effect.ignore),
  );
  return Option.getOrNull(read);
}

export function writeStartHalt(userDataPath: string, record: Omit<StartHaltRecord, "version">): void {
  const path = join(userDataPath, START_HALT_FILE);
  const temporaryPath = `${path}.tmp`;
  const content = `${JSON.stringify({ version: 1, ...record } satisfies StartHaltRecord)}\n`;
  Effect.runSync(
    Effect.try({
      try: () => {
        writeFileSync(temporaryPath, content, { mode: 0o600 });
        renameSync(temporaryPath, path);
      },
      catch: (cause) => new StartHaltFileFailure({ cause }),
    }).pipe(Effect.ignore),
  );
}

export function takeServerStartGuardTest(environment: NodeJS.ProcessEnv, isPackaged: boolean): boolean {
  const value = environment.OPENBOT_E2E_SERVER_START_GUARD;
  delete environment.OPENBOT_E2E_SERVER_START_GUARD;
  return !isPackaged && value === "1";
}
