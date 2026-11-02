// Upgrades a copy of a real `openbot.db` from a released app to migration 47 (tasks become side threads).
// The source file is opened read-only (the app must be closed) and copied with the `sqlite3` CLI; only the copy changes. On the copy:
// the earlier migrations run first, then a forced failure inside 47 must roll back to the task table, then
// 47 runs. Checks: each task with a conversation is a side thread with the same values, and a task with
// none is reported; every other table holds the same rows as before 47; every mailbox message that names
// a task finds its thread; the integrity and foreign-key checks pass.
//   bun scripts/agent-threads-upgrade-e2e.ts <openbot.db> [<openbot.db>...]
// Writes .openbot-build/agent-threads-upgrade-e2e/report.json with counts only, no message text or titles.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateOpenBotDatabase } from "../src/backend/openbot-database-schema";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-threads-upgrade-e2e");
const THREAD_VERSION = 47;
const TASK_COLUMNS =
  "task_id, agent_id, thread_id, origin, title, outcome, error, created_at, updated_at, closed_at, last_event_sequence";

interface SourceReport {
  source: string;
  passed: boolean;
  error?: string;
  sourceVersion?: number;
  tables?: number;
  rows?: number;
  tasks?: number;
  orphanTasks?: number;
  archivedThreads?: number;
  taskMessages?: number;
  taskMessagesWithoutThread?: number;
  rolledBack?: boolean;
}

function version(db: DatabaseSync): number {
  const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get();
  return Number(row?.version ?? 0);
}

function tableNames(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => String(row.name));
}

/** A hash of every row of each table, in a stable order, so that two states compare without the data. */
function tableHashes(db: DatabaseSync): Map<string, { rows: number; hash: string }> {
  const hashes = new Map<string, { rows: number; hash: string }>();
  for (const name of tableNames(db)) {
    if (name === "schema_migrations") continue;
    const rows = db.prepare(`SELECT * FROM "${name}"`).all();
    const lines = rows.map((row) =>
      JSON.stringify(row, (_key, value) => (typeof value === "bigint" ? `${value}` : value)),
    );
    lines.sort();
    hashes.set(name, { rows: rows.length, hash: createHash("sha256").update(lines.join("\n")).digest("hex") });
  }
  return hashes;
}

/** Runs every migration up to `last`; the next one must fail and roll back. */
function migrateUpTo(db: DatabaseSync, last: number): void {
  db.exec(`CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${last}
    BEGIN SELECT RAISE(ABORT, 'upgrade smoke stop'); END;`);
  try {
    assert.throws(() => migrateOpenBotDatabase(db), new RegExp(`migration to version ${last + 1} failed`));
  } finally {
    db.exec("DROP TRIGGER stop_at_version");
  }
}

async function upgrade(source: string, workDirectory: string, index: number): Promise<SourceReport> {
  const report: SourceReport = { source, passed: false };
  const copy = join(workDirectory, `openbot-${index}.db`);
  // A WAL database opens read-only only with its `-shm` file. A running app holds both files, and
  // `.backup` copies under a read lock. A closed app removes them: `immutable=1` then reads with no lock
  // and no file of its own, which is safe because no one writes.
  const uri = existsSync(`${source}-wal`) ? source : `file:${encodeURI(source)}?immutable=1`;
  try {
    execFileSync("sqlite3", ["-readonly", uri, `.backup '${copy.replaceAll("'", "''")}'`], { stdio: "pipe" });
  } catch (error) {
    report.error = `copy failed: ${error instanceof Error ? error.message : String(error)}`;
    return report;
  }

  const db = new DatabaseSync(copy);
  try {
    report.sourceVersion = version(db);
    assert.ok(report.sourceVersion < THREAD_VERSION, `the source is at version ${report.sourceVersion}, not a release`);
    if (report.sourceVersion < THREAD_VERSION - 1) migrateUpTo(db, THREAD_VERSION - 1);
    assert.equal(version(db), THREAD_VERSION - 1);

    const before = tableHashes(db);
    const tasks = db.prepare(`SELECT ${TASK_COLUMNS} FROM projection_agent_tasks ORDER BY task_id`).all();
    const threadIds = new Set(
      db
        .prepare("SELECT thread_id FROM projection_threads")
        .all()
        .map((row) => String(row.thread_id)),
    );
    const kept = tasks.filter((task) => threadIds.has(String(task.thread_id)));
    report.tasks = tasks.length;
    report.orphanTasks = tasks.length - kept.length;
    report.tables = before.size;
    report.rows = [...before.values()].reduce((sum, table) => sum + table.rows, 0);

    // A failure inside 47 leaves the database as it was before 47.
    migrateUpTo(db, THREAD_VERSION - 1);
    assert.equal(version(db), THREAD_VERSION - 1);
    assert.deepEqual(tableHashes(db), before, "a failed migration 47 changed a table");
    report.rolledBack = true;

    migrateOpenBotDatabase(db);
    assert.equal(version(db), THREAD_VERSION);
    const names = tableNames(db);
    assert.ok(!names.includes("projection_agent_tasks"), "the task table is still there");

    const after = tableHashes(db);
    for (const [name, table] of before) {
      if (name === "projection_agent_tasks") continue;
      assert.deepEqual(after.get(name), table, `migration 47 changed ${name}`);
    }

    const threads = new Map(
      db
        .prepare(
          `SELECT thread_id, agent_id, legacy_task_id, origin, title, title_source, outcome, error, created_at,
             updated_at, archived_at, last_event_sequence FROM projection_agent_threads`,
        )
        .all()
        .map((row) => [String(row.legacy_task_id), row]),
    );
    assert.equal(threads.size, kept.length, "a task with a conversation is not a side thread");
    for (const task of kept) {
      const thread = threads.get(String(task.task_id));
      assert.ok(thread, "a task has no side thread");
      assert.deepEqual(
        [thread.thread_id, thread.agent_id, thread.origin, thread.title, thread.outcome, thread.error],
        [task.thread_id, task.agent_id, task.origin, task.title, task.outcome, task.error],
      );
      assert.deepEqual(
        [thread.created_at, thread.updated_at, thread.archived_at, thread.last_event_sequence],
        [task.created_at, task.updated_at, task.closed_at, task.last_event_sequence],
      );
      assert.equal(thread.title_source, task.origin === "agent" ? "agent" : "auto");
    }
    report.archivedThreads = [...threads.values()].filter((thread) => thread.archived_at !== null).length;

    const taskIds = db
      .prepare(
        "SELECT json_extract(message_json, '$.taskId') AS task_id FROM projection_mailbox_messages WHERE json_extract(message_json, '$.taskId') IS NOT NULL",
      )
      .all()
      .map((row) => String(row.task_id));
    report.taskMessages = taskIds.length;
    // A message can name a task that was not copied: its task had no conversation, or no row at all. The
    // app's boot step interrupts its queued delivery (`AgentTasks.endWorkOfGoneTasks`); the row stays.
    report.taskMessagesWithoutThread = taskIds.filter((id) => !threads.has(id)).length;

    const integrity = db.prepare("PRAGMA integrity_check").all();
    assert.deepEqual(
      integrity.map((row) => row.integrity_check),
      ["ok"],
    );
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0, "a foreign key has no row");
    report.passed = true;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    db.close();
  }
  return report;
}

const sources = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (sources.length === 0) {
  process.stderr.write("Usage: bun scripts/agent-threads-upgrade-e2e.ts <openbot.db> [<openbot.db>...]\n");
  process.exit(2);
}
await mkdir(OUT, { recursive: true });
const workDirectory = await mkdtemp(join(tmpdir(), "openbot-thread-upgrade-"));
const reports: SourceReport[] = [];
try {
  for (const [index, source] of sources.entries()) reports.push(await upgrade(resolve(source), workDirectory, index));
} finally {
  await rm(workDirectory, { recursive: true, force: true });
}
const passed = reports.every((report) => report.passed);
await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, reports }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ passed, reports }, null, 2)}\n`);
if (!passed) process.exit(1);
