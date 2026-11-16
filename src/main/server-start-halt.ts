import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import { DatabaseMigrationError, NewerDatabaseError } from "../backend/openbot-database-schema";

/**
 * A server has no window, so it cannot show the recovery window of the desktop. Before, a server
 * whose start failed started again every 10 seconds, without an end (`openbot.service` has
 * `Restart=always`). Now a server stops its start loop: it writes the reason to a small file in the
 * user data folder and exits with `START_LOOP_EXIT_CODE`. `RestartPreventExitStatus=` of the unit
 * then does not start it again. These start it again, and the next start tries once more:
 * - a restart of the server (a boat wake works like a reboot), `openbot restart`, or `openbot start`,
 * - the update timer (`openbot-hosted-update check`, about each 6 hours), with a newer release when one
 *   is staged, or `openbot update`.
 *
 * A server stops the loop at once when a restart cannot help: data from a newer OpenBot, or a
 * failed migration. For each other failure, it stops after the failures in a row that start the
 * recovery window on the desktop (`start-attempts.ts`).
 *
 * The file has a fixed reason word, the app version and a time only: no path, no error text and
 * no secret. It is for the log of the next start and for a later safe mode that shows the reason
 * to the owner.
 */

/** EX_CONFIG of sysexits.h. `scripts/hosting/openbot.service` and `openbot-hosted-update` use the same number. */
export const START_LOOP_EXIT_CODE = 78;
export const START_HALT_FILE = "openbot-start-halt-v1.json";

const StartHaltReason = Schema.Literals(["newer_database", "migration_failed", "start_failed"]);
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

/** The causes that a start error can wrap. A limit, so a loop of causes cannot stop the start. */
const MAX_CAUSE_DEPTH = 8;

/** The reason of a failed start. Only the class of the error is read, never its text. */
export function startHaltReason(error: unknown): StartHaltReason {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if (current instanceof NewerDatabaseError) return "newer_database";
    if (current instanceof DatabaseMigrationError) return "migration_failed";
    current = current.cause;
  }
  return "start_failed";
}

/** True when a restart cannot help, so the server stops the loop after the first failure. */
export function haltsAtOnce(reason: StartHaltReason): boolean {
  return reason !== "start_failed";
}

/**
 * Reads and removes the file of the previous run. A start after a halt tries once more, and a
 * crash of that start must count again: so the file goes before the start continues.
 */
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

/** A failed write only loses the reason for the next start. The rename replaces the file in one step. */
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

/**
 * Reads and removes `OPENBOT_E2E_SERVER_START_GUARD`, so no child process inherits it. With `1`, a
 * development build stops its start loop as a server does. Only `scripts/server-start-loop-e2e.ts`
 * sets it: server mode itself needs a packaged Linux build. A packaged app ignores it.
 */
export function takeServerStartGuardTest(environment: NodeJS.ProcessEnv, isPackaged: boolean): boolean {
  const value = environment.OPENBOT_E2E_SERVER_START_GUARD;
  delete environment.OPENBOT_E2E_SERVER_START_GUARD;
  return !isPackaged && value === "1";
}
