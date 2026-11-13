// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { DATABASE_COPY_DIRECTORY } from "./database/pre-migration-copy";
import { runCauseEffect } from "./effect-boundary";
import { OpenBotDatabase } from "./openbot-database";
import { migrateOpenBotDatabase, readSchemaVersion } from "./openbot-database-schema";

// Failure modes: a start copies the database when no migration runs, or a new database; the copy misses rows or has
// the migrated schema in place of the old one; old copies fill the disk; a failed copy or a full disk stops the start;
// a failed migration changes the database or the copy that was made before it.
const APP_VERSION = "1.2.3";
const roots: string[] = [];
const opened: OpenBotDatabase[] = [];

function closeAll(): void {
  for (const database of opened.splice(0)) database.close();
}

afterEach(async () => {
  closeAll();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const LATEST_VERSION = (() => {
  const db = new DatabaseSync(":memory:");
  migrateOpenBotDatabase(db);
  const version = readSchemaVersion(db);
  db.close();
  return version;
})();

async function userData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-database-copy-"));
  roots.push(root);
  return root;
}

/** Writes `openbot.db` at `version`, as a release with that schema left it, with rows in it. */
function writeDatabaseAt(root: string, version: number, options: { failAtVersion?: number } = {}): void {
  const db = new DatabaseSync(join(root, "openbot.db"));
  db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
  db.exec(`
    INSERT INTO orchestration_events (event_id, command_id, aggregate_type, aggregate_id, event_type, occurred_at,
      payload_json)
    VALUES ('event-1', 'command-1', 'thread', 'openbot-thread-chief', 'thread.created', '2026-10-01T09:00:00.000Z',
      '{"title":"Chief"}');
    INSERT INTO projection_threads
      (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
    VALUES ('openbot-thread-chief', 'chief', 'Chief', NULL, '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z', 1);`);
  if (options.failAtVersion !== undefined) {
    // Not a temp trigger: it must stop the migration in the connection that the start opens.
    db.exec(`CREATE TRIGGER fail_migration BEFORE INSERT ON schema_migrations
      WHEN new.version = ${options.failAtVersion} BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;`);
  }
  db.close();
}

function start(root: string, options: { appVersion?: string; freeDiskBytes?: () => Promise<number> } = {}) {
  const database = new OpenBotDatabase(root, {
    appVersion: options.appVersion ?? APP_VERSION,
    ...(options.freeDiskBytes ? { freeDiskBytes: options.freeDiskBytes } : {}),
  });
  opened.push(database);
  return runCauseEffect(database.initialize());
}

/** Every row of every table, so a lost or changed row in any table fails the comparison. */
function readContents(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => String(row.name));
    const contents = Object.fromEntries(
      tables.map((table) => [
        table,
        db
          .prepare(`SELECT * FROM "${table}"`)
          .all()
          .map((row) => JSON.stringify(row))
          .sort(),
      ]),
    );
    return { version: readSchemaVersion(db), contents };
  } finally {
    db.close();
  }
}

function rowsOf(path: string, table: string): unknown[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
  } finally {
    db.close();
  }
}

async function copyNames(root: string): Promise<string[]> {
  const directory = join(root, DATABASE_COPY_DIRECTORY);
  return existsSync(directory) ? (await readdir(directory)).sort() : [];
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

describe("the copy of openbot.db before a migration", () => {
  it("makes no copy of a new database or of a database with no pending migration", async () => {
    const root = await userData();
    await start(root);
    closeAll();
    expect(readContents(join(root, "openbot.db")).version).toBe(LATEST_VERSION);

    await start(root);
    expect(existsSync(join(root, DATABASE_COPY_DIRECTORY))).toBe(false);
  });

  it.each([8, LATEST_VERSION - 1])(
    "copies a database at version %i with its schema version and all rows",
    async (version) => {
      const root = await userData();
      writeDatabaseAt(root, version);
      const before = readContents(join(root, "openbot.db"));
      expect(before.version).toBe(version);

      await start(root);

      const names = await copyNames(root);
      expect(names).toHaveLength(1);
      expect(names[0]).toMatch(new RegExp(`^\\d{8}T\\d{9}Z-schema-${version}-before-1\\.2\\.3\\.db$`, "u"));
      const copyPath = join(root, DATABASE_COPY_DIRECTORY, names[0] ?? "");
      expect(readContents(copyPath)).toEqual(before);
      if (process.platform !== "win32") expect((await stat(copyPath)).mode & 0o777).toBe(0o600);

      closeAll();
      const after = join(root, "openbot.db");
      expect(readContents(after).version).toBe(LATEST_VERSION);
      expect(rowsOf(after, "orchestration_events")).toEqual(rowsOf(copyPath, "orchestration_events"));
      expect(rowsOf(after, "projection_threads")).toHaveLength(1);
    },
  );

  it("keeps the newest two copies and leaves other files", async () => {
    const root = await userData();
    const directory = join(root, DATABASE_COPY_DIRECTORY);
    writeDatabaseAt(root, LATEST_VERSION - 1);
    await start(root);
    closeAll();
    const [newest] = await copyNames(root);

    // Two older copies, a copy that a kill stopped, and a file that the user put there.
    await writeFile(join(directory, "20200101T000000000Z-schema-40-before-0.40.0.db"), "older");
    await writeFile(join(directory, "20210101T000000000Z-schema-50-before-0.50.0.db"), "old");
    await writeFile(join(directory, "20220101T000000000Z-schema-55-before-0.55.0.db.partial"), "stopped");
    await writeFile(join(directory, "notes.txt"), "mine");
    // The upgrade to the next release.
    await rm(join(root, "openbot.db"));
    writeDatabaseAt(root, LATEST_VERSION - 1);

    await start(root, { appVersion: "1.2.4" });

    const names = await copyNames(root);
    expect(names.filter((name) => name.endsWith(".db"))).toHaveLength(2);
    expect(names).toContain(newest);
    expect(names).toContain("notes.txt");
    expect(names.some((name) => name.startsWith("2020") || name.startsWith("2021"))).toBe(false);
    expect(names.some((name) => name.endsWith(".partial"))).toBe(false);
  });

  it("migrates as before when the copy fails", async () => {
    const root = await userData();
    writeDatabaseAt(root, LATEST_VERSION - 1);
    const before = readContents(join(root, "openbot.db"));
    // A file where the folder must be: the copy cannot make its folder.
    await writeFile(join(root, DATABASE_COPY_DIRECTORY), "not a folder");

    await start(root);
    closeAll();

    const after = readContents(join(root, "openbot.db"));
    expect(after.version).toBe(LATEST_VERSION);
    expect(after.contents.orchestration_events).toEqual(before.contents.orchestration_events);
    expect(after.contents.projection_threads).toEqual(before.contents.projection_threads);
    expect(await readFile(join(root, DATABASE_COPY_DIRECTORY), "utf8")).toBe("not a folder");
  });

  it("migrates without a copy when the disk has not enough free space", async () => {
    const root = await userData();
    writeDatabaseAt(root, LATEST_VERSION - 1);

    await start(root, { freeDiskBytes: async () => 0 });
    closeAll();

    expect(await copyNames(root)).toEqual([]);
    expect(readContents(join(root, "openbot.db")).version).toBe(LATEST_VERSION);
  });

  it("removes the oldest copy first when only that gives enough free space", async () => {
    const root = await userData();
    const directory = join(root, DATABASE_COPY_DIRECTORY);
    await mkdir(directory, { recursive: true });
    const oldest = "20200101T000000000Z-schema-40-before-0.40.0.db";
    const old = "20210101T000000000Z-schema-50-before-0.50.0.db";
    await writeFile(join(directory, oldest), "older");
    await writeFile(join(directory, old), "old");
    writeDatabaseAt(root, LATEST_VERSION - 1);

    // The old copies are too small to give enough space: the start removes none of them and makes no copy.
    await start(root, { freeDiskBytes: async () => 0 });
    closeAll();
    expect(await copyNames(root)).toEqual([oldest, old]);

    // A large oldest copy (a sparse file) gives enough space when the start removes it.
    await truncate(join(directory, oldest), 256 * 1024 * 1024);
    await rm(join(root, "openbot.db"));
    writeDatabaseAt(root, LATEST_VERSION - 1);
    await start(root, { freeDiskBytes: async () => 0 });
    closeAll();

    const names = await copyNames(root);
    expect(names).toHaveLength(2);
    expect(names[0]).toBe(old);
    expect(names[1]).toMatch(
      new RegExp(`-schema-${LATEST_VERSION - 1}-before-${APP_VERSION.replaceAll(".", "\\.")}\\.db$`, "u"),
    );
    expect(readContents(join(directory, names[1] ?? "")).contents.projection_threads).toHaveLength(1);
  });

  it("rolls the database back and keeps the copy unchanged when a migration fails", async () => {
    const root = await userData();
    const sourceVersion = LATEST_VERSION - 2;
    writeDatabaseAt(root, sourceVersion, { failAtVersion: sourceVersion + 1 });
    const before = readContents(join(root, "openbot.db"));
    // A copy that the upgrade to an earlier release made.
    const previousRelease = "20200101T000000000Z-schema-40-before-0.40.0.db";
    await mkdir(join(root, DATABASE_COPY_DIRECTORY));
    await writeFile(join(root, DATABASE_COPY_DIRECTORY, previousRelease), "previous release");

    await expect(start(root)).rejects.toThrow(`migration to version ${sourceVersion + 1} failed`);
    closeAll();
    expect(readContents(join(root, "openbot.db"))).toEqual(before);
    const [, first] = await copyNames(root);
    expect(readContents(join(root, DATABASE_COPY_DIRECTORY, first ?? ""))).toEqual(before);

    // The next start tries again. Its copy has the same data and replaces the first, and the copy of
    // the earlier release stays.
    await expect(start(root)).rejects.toThrow(`migration to version ${sourceVersion + 1} failed`);
    closeAll();
    expect(readContents(join(root, "openbot.db"))).toEqual(before);
    const names = await copyNames(root);
    expect(names).toHaveLength(2);
    expect(names[0]).toBe(previousRelease);
    expect(names[1]).not.toBe(first);
    expect(readContents(join(root, DATABASE_COPY_DIRECTORY, names[1] ?? ""))).toEqual(before);
  });

  it("keeps the copy from before a migration that committed in part, also after restarts", async () => {
    const root = await userData();
    const sourceVersion = LATEST_VERSION - 3;
    writeDatabaseAt(root, sourceVersion, { failAtVersion: sourceVersion + 2 });
    const before = readContents(join(root, "openbot.db"));

    await expect(start(root)).rejects.toThrow(`migration to version ${sourceVersion + 2} failed`);
    closeAll();
    // Only the failed migration rolled back. The one before it committed.
    expect(readContents(join(root, "openbot.db")).version).toBe(sourceVersion + 1);
    const [first] = await copyNames(root);
    const firstPath = join(root, DATABASE_COPY_DIRECTORY, first ?? "");
    const firstHash = await sha256(firstPath);

    // More restarts than the copies that stay: the release before the upgrade can open only this copy.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(start(root)).rejects.toThrow(`migration to version ${sourceVersion + 2} failed`);
      closeAll();
    }
    expect(await copyNames(root)).toEqual([first]);
    expect(await sha256(firstPath)).toBe(firstHash);
    expect(readContents(firstPath)).toEqual(before);
  });
});
