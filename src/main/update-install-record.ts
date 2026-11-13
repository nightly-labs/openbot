import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Option, Schema } from "effect";

const logger = createOpenBotLogger("update");

/**
 * A small file that an update restart writes just before it hands the app to the installer. The next
 * start reads it: when that start still runs the version that wrote it, the installer did not
 * replace the app. On macOS this happens when ShipIt finds OpenBot running again and cancels the
 * install (#8099). Without the record, the app only shows the same "ready" banner again.
 */
const UpdateInstallRecord = Schema.Struct({ fromVersion: Schema.String, targetVersion: Schema.String });
const decodeRecord = Schema.decodeUnknownOption(Schema.fromJsonString(UpdateInstallRecord));

/** The version that the last update restart did not install, or null. A record that is done is removed. */
export function readNotAppliedUpdate(path: string, currentVersion: string): string | null {
  const record = Effect.runSync(
    Effect.try(() => readFileSync(path, "utf8")).pipe(
      Effect.map(decodeRecord),
      Effect.orElseSucceed(() => Option.none<typeof UpdateInstallRecord.Type>()),
    ),
  );
  if (Option.isSome(record)) {
    const { fromVersion, targetVersion } = record.value;
    if (fromVersion === currentVersion && targetVersion !== currentVersion) {
      logger.warn(`The last update restart did not install OpenBot ${targetVersion}.`);
      return targetVersion;
    }
  }
  Effect.runSync(Effect.try(() => rmSync(path, { force: true })).pipe(Effect.ignore));
  return null;
}

/** Synchronous, because the process ends soon after. A failed write only loses the notice. */
export function writeUpdateInstallRecord(path: string, fromVersion: string, targetVersion: string): void {
  Effect.runSync(
    Effect.try(() => writeFileSync(path, JSON.stringify({ fromVersion, targetVersion }), { mode: 0o600 })).pipe(
      Effect.catch((error) =>
        Effect.sync(() => logger.warn("The update install record was not saved.", toLogValue(error))),
      ),
    ),
  );
}
