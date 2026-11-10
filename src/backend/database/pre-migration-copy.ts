import { chmod, mkdir, readdir, rename, rm, statfs } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";
import { readSchemaVersion } from "../openbot-database-schema";
import { type StoredStateFailure, storedIO, storedSync } from "../stored-state-effects";

/** The folder next to `openbot.db` that holds the copies. */
export const DATABASE_COPY_DIRECTORY = "openbot-db-copies";
/** The number of copies that stay. A new copy removes the older ones. */
const KEPT_DATABASE_COPIES = 2;
// Free space that stays after the copy, in addition to the size of the database: a migration that
// rebuilds a table, and the VACUUM after it, need about that much. A copy must not take the space
// that the migration needs.
const SPACE_RESERVE_BYTES = 64 * 1024 * 1024;
const COPY_NAME = /^\d{8}T\d{9}Z-schema-(\d+)-before-([A-Za-z0-9._-]+)\.db$/u;
const PARTIAL_SUFFIX = ".partial";

export interface DatabaseCopyOptions {
  /** The version of the app that runs the migration. It is part of the copy's name. */
  appVersion?: string;
  /** The free bytes on the disk that holds `directory`. Tests replace it. */
  freeDiskBytes?: (directory: string) => Promise<number>;
}

type DatabaseCopyResult =
  | { status: "copied"; fileName: string; removedCopies: number }
  | { status: "kept"; fileName: string }
  | { status: "skipped"; requiredBytes: number; freeBytes: number };

/** A copy step failed. The cause stays private: a file system error message holds a user path. */
export class DatabaseCopyFailure extends Schema.TaggedError<DatabaseCopyFailure>()("DatabaseCopyFailure", {
  stage: Schema.Literals(["prepare", "copy", "verify", "rotate"]),
  cause: Schema.Defect(),
}) {}

interface DatabaseCopyInput extends DatabaseCopyOptions {
  db: DatabaseSync;
  databasePath: string;
  sourceVersion: number;
  now?: Date;
}

/**
 * Copies the open database, before its first pending migration, into `openbot-db-copies` next to
 * it. `VACUUM INTO` reads one consistent snapshot, the write-ahead log included. The copy gets its
 * final name only after it opens and passes `PRAGMA integrity_check` with the source schema version,
 * so a file with that name is always a complete copy. Then only the newest `KEPT_DATABASE_COPIES`
 * copies stay. When the disk has not enough free space, it makes no copy and returns `skipped`.
 *
 * A start after a failed migration tries again. When this app version already copied the database
 * at a lower schema version, some of its migrations committed before the failure, and only that
 * older copy opens in the release before it. That copy stays and no new copy is made (`kept`), so
 * restarts cannot rotate it out. A copy at the same schema version is replaced by the new one.
 *
 * Releases before this one made no copy, so no code may assume that a copy exists.
 */
export const copyDatabaseBeforeMigration = Effect.fn("copyDatabaseBeforeMigration")(function* (
  input: DatabaseCopyInput,
) {
  const directory = join(dirname(input.databasePath), DATABASE_COPY_DIRECTORY);
  const freeDiskBytes = input.freeDiskBytes ?? readFreeDiskBytes;
  yield* step("prepare", () => mkdir(directory, { recursive: true, mode: 0o700 }));
  yield* step("prepare", () => chmod(directory, 0o700));
  // A copy that a kill or a crash stopped. It has no final name, so no one can mistake it for a copy.
  yield* step("prepare", () => removeFiles(directory, (name) => isCopyName(name, PARTIAL_SUFFIX)));

  const sizes = yield* stage(
    "prepare",
    storedSync(() => readSizes(input.db)),
  );
  const requiredBytes = sizes.copyBytes + sizes.databaseBytes + SPACE_RESERVE_BYTES;
  const freeBytes = yield* step("prepare", () => freeDiskBytes(directory));
  if (freeBytes < requiredBytes) return { status: "skipped", requiredBytes, freeBytes } satisfies DatabaseCopyResult;

  const appVersion = safeAppVersion(input.appVersion);
  const earlier = yield* step("prepare", () => readCopies(directory)).pipe(
    Effect.map((copies) => copies.filter((copy) => copy.appVersion === appVersion)),
  );
  const older = earlier.find((copy) => copy.sourceVersion < input.sourceVersion);
  if (older) return { status: "kept", fileName: older.name } satisfies DatabaseCopyResult;

  const fileName = copyFileName(input.sourceVersion, appVersion, input.now ?? new Date());
  const target = join(directory, fileName);
  const partial = `${target}${PARTIAL_SUFFIX}`;
  yield* Effect.gen(function* () {
    yield* stage(
      "copy",
      storedSync(() => input.db.prepare("VACUUM INTO ?").run(partial)),
    );
    yield* stage(
      "verify",
      storedSync(() => verifyCopy(partial, input.sourceVersion)),
    );
    yield* step("copy", () => chmod(partial, 0o600));
    yield* step("copy", () => rename(partial, target));
  }).pipe(Effect.onError(() => storedIO(() => rm(partial, { force: true })).pipe(Effect.ignore)));

  const replaced = new Set(
    earlier
      .filter((copy) => copy.sourceVersion === input.sourceVersion && copy.name !== fileName)
      .map((copy) => copy.name),
  );
  const removedCopies = yield* step("rotate", () => removeOlderCopies(directory, replaced));
  return { status: "copied", fileName, removedCopies } satisfies DatabaseCopyResult;
});

function stage<A>(name: DatabaseCopyFailure["stage"], effect: Effect.Effect<A, StoredStateFailure>) {
  return effect.pipe(Effect.mapError((failure) => new DatabaseCopyFailure({ stage: name, cause: failure.cause })));
}

function step<A>(name: DatabaseCopyFailure["stage"], operation: () => Promise<A>) {
  return stage(name, storedIO(operation));
}

async function readFreeDiskBytes(directory: string): Promise<number> {
  const stats = await statfs(directory);
  return stats.bavail * stats.bsize;
}

/** The size of the file, and the size of a copy without its free pages. */
function readSizes(db: DatabaseSync): { databaseBytes: number; copyBytes: number } {
  const pageSize = pragmaNumber(db, "page_size");
  const pageCount = pragmaNumber(db, "page_count");
  const freePages = pragmaNumber(db, "freelist_count");
  return { databaseBytes: pageCount * pageSize, copyBytes: Math.max(0, pageCount - freePages) * pageSize };
}

function pragmaNumber(db: DatabaseSync, name: string): number {
  const row = db.prepare(`PRAGMA ${name}`).get();
  const value = isDynamicRecord(row) ? row[name] : undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`SQLite returned no number for PRAGMA ${name}.`);
  }
  return value;
}

function verifyCopy(path: string, sourceVersion: number): void {
  const copy = new DatabaseSync(path, { readOnly: true });
  try {
    const problems = copy
      .prepare("PRAGMA integrity_check(20)")
      .all()
      .map((row) => (isDynamicRecord(row) ? row.integrity_check : row));
    if (problems.length !== 1 || problems[0] !== "ok") {
      throw new Error("The database copy failed its integrity check.");
    }
    if (readSchemaVersion(copy) !== sourceVersion) {
      throw new Error("The database copy has a different schema version than the database.");
    }
  } finally {
    copy.close();
  }
}

function safeAppVersion(appVersion: string | undefined): string {
  return appVersion?.replace(/[^A-Za-z0-9.-]/gu, "_") || "unknown";
}

/** `<UTC time to the millisecond>-schema-<source version>-before-<app version>.db`, so names sort by age. */
function copyFileName(sourceVersion: number, appVersion: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:.]/gu, "");
  return `${stamp}-schema-${sourceVersion}-before-${appVersion}.db`;
}

function isCopyName(name: string, suffix = ""): boolean {
  return name.endsWith(suffix) && COPY_NAME.test(name.slice(0, name.length - suffix.length));
}

interface StoredCopy {
  name: string;
  sourceVersion: number;
  appVersion: string;
}

/** The copies in `directory`, oldest first. Files with other names are not copies. */
async function readCopies(directory: string): Promise<StoredCopy[]> {
  return (await readdir(directory)).sort().flatMap((name) => {
    const match = COPY_NAME.exec(name);
    return match ? [{ name, sourceVersion: Number(match[1]), appVersion: match[2] ?? "" }] : [];
  });
}

/** Removes the `replaced` copies, then every copy except the newest `KEPT_DATABASE_COPIES`. Files with other names stay. */
async function removeOlderCopies(directory: string, replaced: ReadonlySet<string>): Promise<number> {
  const copies = (await readCopies(directory)).map((copy) => copy.name).filter((name) => !replaced.has(name));
  const older = new Set([...replaced, ...copies.slice(0, Math.max(0, copies.length - KEPT_DATABASE_COPIES))]);
  return removeFiles(directory, (name) => older.has(name));
}

async function removeFiles(directory: string, select: (name: string) => boolean): Promise<number> {
  const names = (await readdir(directory)).filter(select);
  for (const name of names) await rm(join(directory, name), { force: true });
  return names.length;
}
