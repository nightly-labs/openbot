import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";

/**
 * macOS (#9776). After "Restart to update", OpenBot quits and Squirrel.Mac's ShipIt checks the new app
 * for up to a minute before it replaces the old one. Nothing is on screen in that time. Just before the
 * swap, ShipIt cancels the install when OpenBot runs ("App Still Running"), and the old version stays.
 * Users opened OpenBot again in that minute and so cancelled their own update. Such a launch now exits
 * at once: ShipIt opens the new version when it is done.
 *
 * Each doubt starts the app as before: no record, an old record, a newer version (the install worked),
 * no running ShipIt, or a ShipIt that already finished or opens the app itself.
 */

/** In user data. Written just before the handover to the installer. */
export const UPDATE_HANDOVER_FILE = "update-handover.json";
const SHIPIT_JOB_LABEL = "app.openbot.desktop.ShipIt";
/** Squirrel stages the ZIP before the quit (up to `UPDATE_INSTALL_TIMEOUT_MS`), then ShipIt runs. A backstop only. */
const HANDOVER_MAX_AGE_MS = 10 * 60 * 1_000;
const LOG_TAIL_BYTES = 64 * 1024;
// Lines that Squirrel.Mac's ShipIt-main.m writes to its standard error. "and launching:" comes before
// ShipIt opens the app, and its `atexit` block writes "ShipIt quitting".
const SHIPIT_INSTALL_REQUEST = "Detected this as an install request";
const SHIPIT_LAUNCHING_APP = "and launching:";
const SHIPIT_QUITTING = "ShipIt quitting";

/** Squirrel.Mac keeps the ShipIt state and logs here, named after its launchd job. */
export function macShipItDirectory(): string {
  return join(homedir(), "Library", "Caches", SHIPIT_JOB_LABEL);
}

const UpdateHandover = Schema.Struct({ fromVersion: Schema.String, startedAt: Schema.Number });
const decodeHandover = Schema.decodeUnknownOption(Schema.fromJsonString(UpdateHandover));

export const writeUpdateHandover = Effect.fn("writeUpdateHandover")(function* (
  path: string,
  fromVersion: string,
  startedAt: number,
) {
  yield* Effect.try(() => writeFileSync(path, JSON.stringify({ fromVersion, startedAt }), { mode: 0o600 }));
});

/**
 * In user data, macOS (#11768). ShipIt replaces the app after OpenBot quits, so a failed replace (for
 * example "Too many attempts to install") never reaches the app: the next start found the same update
 * and showed "Update ready" again with no error. The next start reads this record. When it still runs
 * `fromVersion`, the restart did not install `targetVersion`. Unlike the handover, it has no age limit.
 */
export const UPDATE_INSTALL_RECORD_FILE = "update-install.json";

const UpdateInstallRecord = Schema.Struct({ fromVersion: Schema.String, targetVersion: Schema.String });
const decodeInstallRecord = Schema.decodeUnknownOption(Schema.fromJsonString(UpdateInstallRecord));

export const writeUpdateInstallRecord = Effect.fn("writeUpdateInstallRecord")(function* (
  path: string,
  fromVersion: string,
  targetVersion: string,
) {
  yield* Effect.try(() => writeFileSync(path, JSON.stringify({ fromVersion, targetVersion }), { mode: 0o600 }));
});

/** The version that the last update restart did not install, or null. Any other record is removed. */
export const readNotInstalledUpdate = Effect.fn("readNotInstalledUpdate")(function* (
  path: string,
  currentVersion: string,
) {
  const record = yield* Effect.try(() => readFileSync(path, "utf8")).pipe(
    Effect.map(decodeInstallRecord),
    Effect.orElseSucceed(() => Option.none<typeof UpdateInstallRecord.Type>()),
  );
  if (
    Option.isSome(record) &&
    record.value.fromVersion === currentVersion &&
    record.value.targetVersion !== currentVersion
  )
    return record.value.targetVersion;
  yield* Effect.try(() => rmSync(path, { force: true })).pipe(Effect.ignore);
  return null;
});

/**
 * Synchronous I/O: it runs before the single-instance lock, and a launch that it stops must end at once.
 * A record of this version that is still young stays, also when ShipIt has not started yet, so a later
 * launch in the same install is still stopped. Any other record is removed.
 */
export const shipItInstallInProgress = Effect.fn("shipItInstallInProgress")(function* (options: {
  userDataPath: string;
  shipItDirectory: string;
  currentVersion: string;
  now: number;
}) {
  const recordPath = join(options.userDataPath, UPDATE_HANDOVER_FILE);
  const record = yield* Effect.try(() => readFileSync(recordPath, "utf8")).pipe(
    Effect.map(decodeHandover),
    Effect.orElseSucceed(() => Option.none<typeof UpdateHandover.Type>()),
  );
  const current =
    Option.isSome(record) &&
    record.value.fromVersion === options.currentVersion &&
    options.now >= record.value.startedAt &&
    options.now - record.value.startedAt < HANDOVER_MAX_AGE_MS;
  if (!current) {
    yield* Effect.try(() => rmSync(recordPath, { force: true })).pipe(Effect.ignore);
    return false;
  }
  const logPath = join(options.shipItDirectory, "ShipIt_stderr.log");
  return (yield* shipItLogShowsInstall(logPath, record.value.startedAt)) && (yield* shipItJobRuns());
});

/** The last ShipIt run wrote to its log after the handover, and has not opened the app or quit since. */
const shipItLogShowsInstall = (logPath: string, handoverAt: number) =>
  Effect.try(() => {
    const { mtimeMs, size } = statSync(logPath);
    if (mtimeMs < handoverAt) return false;
    const length = Math.min(size, LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    const fd = openSync(logPath, "r");
    try {
      readSync(fd, buffer, 0, length, size - length);
    } finally {
      closeSync(fd);
    }
    const tail = buffer.toString("utf8");
    const start = tail.lastIndexOf(SHIPIT_INSTALL_REQUEST);
    if (start === -1) return false;
    const run = tail.slice(start);
    return !run.includes(SHIPIT_LAUNCHING_APP) && !run.includes(SHIPIT_QUITTING);
  }).pipe(Effect.orElseSucceed(() => false));

/** A ShipIt that stopped without its last log line, for example at a restart of the Mac, has no process. */
const shipItJobRuns = () =>
  Effect.try(() => {
    const result = spawnSync("/bin/launchctl", ["list", SHIPIT_JOB_LABEL], { encoding: "utf8", timeout: 2_000 });
    return result.status === 0 && /"PID" = \d+;/u.test(result.stdout);
  }).pipe(Effect.orElseSucceed(() => false));
