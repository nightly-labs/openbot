import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";

export const UPDATE_HANDOVER_FILE = "update-handover.json";
const SHIPIT_JOB_LABEL = "app.openbot.desktop.ShipIt";
const HANDOVER_MAX_AGE_MS = 10 * 60 * 1_000;
const LOG_TAIL_BYTES = 64 * 1024;
const SHIPIT_INSTALL_REQUEST = "Detected this as an install request";
const SHIPIT_LAUNCHING_APP = "and launching:";
const SHIPIT_QUITTING = "ShipIt quitting";

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

const shipItJobRuns = () =>
  Effect.try(() => {
    const result = spawnSync("/bin/launchctl", ["list", SHIPIT_JOB_LABEL], { encoding: "utf8", timeout: 2_000 });
    return result.status === 0 && /"PID" = \d+;/u.test(result.stdout);
  }).pipe(Effect.orElseSucceed(() => false));
