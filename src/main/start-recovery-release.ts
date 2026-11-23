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
  databaseSchemaVersion: number | null;
  appSchemaVersion: number;
}

export function compatiblePreviousRelease({
  summary,
  databaseSchemaVersion,
  appSchemaVersion,
}: PreviousReleaseInput): string | null {
  const version = summary.lastGoodVersion;
  if (!version || version === summary.appVersion || !isValidSemver(version)) return null;
  const opens = summary.lastGoodSchemaVersion ?? RELEASED_SCHEMA_VERSIONS[version] ?? null;
  if (opens === null) return null;
  return opens >= (databaseSchemaVersion ?? appSchemaVersion) ? version : null;
}
