// Which earlier release the recovery window can offer (`start-recovery-window.ts`). A release that
// cannot open the database schema on the disk stops with `NewerDatabaseError` and then installs the
// latest release, which can be the release that does not start. So the window offers an earlier
// release only when that release can open the data.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isValidSemver } from "@openbot/contracts/release-version";
import { Effect, Schema } from "effect";
import { RELEASED_SCHEMA_VERSIONS } from "./released-schema-versions";
import type { StartAttemptsSummary } from "./start-attempts";

class DatabaseSchemaReadFailure extends Schema.TaggedError<DatabaseSchemaReadFailure>()("DatabaseSchemaReadFailure", {
  cause: Schema.Defect(),
}) {}

/**
 * The newest migration in `openbot.db`, read on a read-only connection that changes nothing. 0 when
 * the file does not exist. `null` when it cannot be read, for example when another process locks it.
 */
export function readDatabaseSchemaVersion(userDataPath: string): number | null {
  const path = join(userDataPath, "openbot.db");
  return Effect.runSync(
    Effect.try({
      try: () => {
        if (!existsSync(path)) return 0;
        const db = new DatabaseSync(path, { readOnly: true });
        try {
          const table = db
            .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
            .get();
          if (!table) return null;
          const version = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()?.version;
          return typeof version === "number" && Number.isInteger(version) ? version : null;
        } finally {
          db.close();
        }
      },
      catch: (cause) => new DatabaseSchemaReadFailure({ cause }),
    }).pipe(Effect.orElseSucceed(() => null)),
  );
}

interface PreviousReleaseInput {
  summary: StartAttemptsSummary;
  /** From `readDatabaseSchemaVersion`. */
  databaseSchemaVersion: number | null;
  /** The highest schema version of this build. A database that it did not refuse is not newer. */
  appSchemaVersion: number;
}

/**
 * The last version that finished a start, when it can open the database on the disk. `null` when
 * there is none, or when it is not sure that it can open the data.
 */
export function compatiblePreviousRelease({
  summary,
  databaseSchemaVersion,
  appSchemaVersion,
}: PreviousReleaseInput): string | null {
  const version = summary.lastGoodVersion;
  if (!version || version === summary.appVersion || !isValidSemver(version)) return null;
  const opens = summary.lastGoodSchemaVersion ?? RELEASED_SCHEMA_VERSIONS[version] ?? null;
  if (opens === null) return null;
  // When the file cannot be read, this build can have migrated it up to its own schema version.
  return opens >= (databaseSchemaVersion ?? appSchemaVersion) ? version : null;
}
