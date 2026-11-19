import { spawn } from "node:child_process";
import { constants, copyFileSync, existsSync, mkdirSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import {
  buildDatabaseAtVersion,
  HARNESS_APPLIED_AT,
  latestAppliedVersion,
  openHarnessDatabase,
  query,
  quote,
  seedEveryTable,
} from "../src/backend/migration-harness";
import { migrateOpenBotDatabase } from "../src/backend/openbot-database-schema";

const OUT = resolve(import.meta.dirname, "../.openbot-build/migration-large-db");
const BIG_TABLES = ["orchestration_events", "provider_history_staging", "projection_thread_messages"] as const;
const GIB = 1024 ** 3;

function flag(name: string): string | undefined {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

interface StartResult {
  seconds: number;
  maxRssBytes: number;
  startRssBytes: number;
  changedRows: number;
  version: number;
  bigTables: Record<string, string[]>;
}

interface SchemaObject {
  type: string;
  name: string;
  table: string;
  rootpage: number;
  sql: string;
}

function schemaObjects(db: DatabaseSync): SchemaObject[] {
  return query(db, "SELECT type, name, tbl_name, rootpage, sql FROM sqlite_master WHERE sql IS NOT NULL").map(
    (row) => ({
      type: String(row.type),
      name: String(row.name),
      table: String(row.tbl_name),
      rootpage: Number(row.rootpage),
      sql: String(row.sql),
    }),
  );
}

function bigTableWork(before: readonly SchemaObject[], after: readonly SchemaObject[]): Record<string, string[]> {
  const work: Record<string, string[]> = {};
  const find = (objects: readonly SchemaObject[], name: string) => objects.find((object) => object.name === name);
  for (const table of BIG_TABLES) {
    const notes: string[] = [];
    const old = find(before, table);
    const now = find(after, table);
    if (old && !now) notes.push("dropped");
    if (old && now && old.sql !== now.sql) notes.push(old.rootpage === now.rootpage ? "altered" : "rebuilt");
    for (const object of after) {
      if (object.type === "index" && object.table === table && !find(before, object.name)) {
        notes.push(`new index ${object.name}`);
      }
    }
    if (notes.length > 0) work[table] = notes;
  }
  return work;
}

const childDatabase = flag("start");
if (childDatabase) {
  const through = Number(flag("through"));
  const startRssBytes = process.memoryUsage().rss;
  const db = openHarnessDatabase(childDatabase);
  const before = schemaObjects(db);
  const started = performance.now();
  migrateOpenBotDatabase(db, { appliedAt: HARNESS_APPLIED_AT, throughVersion: through, closedCleanly: true });
  const seconds = (performance.now() - started) / 1000;
  const changes = query(db, "SELECT total_changes() AS n")[0]?.n;
  const result: StartResult = {
    seconds,
    maxRssBytes: process.resourceUsage().maxRSS * 1024,
    startRssBytes,
    changedRows: isNumber(changes) ? changes : 0,
    version: latestAppliedVersion(db),
    bigTables: bigTableWork(before, schemaObjects(db)),
  };
  db.close();
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

const checksDatabase = flag("checks");
if (checksDatabase) {
  const db = openHarnessDatabase(checksDatabase);
  const timed = (sql: string): number => {
    const started = performance.now();
    db.prepare(sql).all();
    return (performance.now() - started) / 1000;
  };
  const result = {
    foreignKeyCheckSeconds: timed("PRAGMA foreign_key_check"),
    quickCheckSeconds: timed("PRAGMA quick_check(20)"),
  };
  db.close();
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

const sizeGb = process.argv.includes("--full") ? 17 : Number(flag("size-gb") ?? "1.5");
const fromVersion = Number(flag("from") ?? "29");
if (!(sizeGb > 0) || !Number.isInteger(fromVersion) || fromVersion < 8) {
  throw new Error("Usage: bun scripts/migration-large-db-e2e.ts [--size-gb=<GB>] [--from=<version 8 or later>]");
}
const targetBytes = sizeGb * GIB;

rmSync(OUT, { recursive: true, force: true });
const temp = join(OUT, "tmp");
mkdirSync(temp, { recursive: true });
const neededBytes = targetBytes * 5;
if (freeBytes() < neededBytes) {
  throw new Error(`This run needs ${(neededBytes / GIB).toFixed(1)} GB of free disk in ${OUT}.`);
}

function freeBytes(): number {
  const stats = statfsSync(OUT);
  return stats.bavail * stats.bsize;
}

function fileBytes(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

function payload<Fields extends object>(bytes: number, fields: Fields, seed: number): string {
  const head = JSON.stringify(fields);
  const fill = Math.max(0, bytes - head.length - 16);
  const text = `${seed.toString(36)} ${'Lorem ipsum dolor sit amet, 界 \\"quoted\\" '.repeat(Math.ceil(fill / 40))}`;
  return JSON.stringify({ ...fields, text: text.slice(0, fill) });
}

function cloner(db: DatabaseSync, table: string): (values: Record<string, string | number | null>) => void {
  const template = query(db, `SELECT * FROM ${quote(table)} ORDER BY rowid LIMIT 1`)[0];
  if (!template) throw new Error(`The seed has no row in ${table}.`);
  const columns = Object.keys(template);
  const insert = db.prepare(
    `INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  );
  return (values) => {
    insert.run(
      ...columns.map((column) => {
        const value = column in values ? values[column] : template[column];
        return isString(value) || isNumber(value) || value === null ? value : null;
      }),
    );
  };
}

interface Generated {
  seconds: number;
  fileBytes: number;
  rows: Record<string, number>;
  repeatedMailboxEvents: number;
}

function generate(path: string): Generated {
  const started = performance.now();
  const db = openHarnessDatabase(path);
  buildDatabaseAtVersion(db, fromVersion);
  seedEveryTable(db);
  const tables = new Set(query(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name));
  const threadCount = Math.max(20, Math.round(sizeGb * 120));
  const addThread = cloner(db, "projection_threads");
  const addEvent = cloner(db, "orchestration_events");
  const addReceipt = cloner(db, "orchestration_command_receipts");
  const addMessage = cloner(db, "projection_thread_messages");
  const addActivity = cloner(db, "projection_thread_activities");
  const hasStaging = tables.has("provider_history_staging");
  const addStaging = hasStaging ? cloner(db, "provider_history_staging") : null;
  const sessionRow = hasStaging ? query(db, "SELECT session_id FROM provider_history_imports LIMIT 1")[0] : undefined;

  const time = (index: number): string => new Date(Date.UTC(2026, 5, 1) + index * 1000).toISOString();
  let sequence = Number(query(db, "SELECT MAX(sequence) AS n FROM orchestration_events")[0]?.n ?? 0);
  let repeatedMailboxEvents = 0;
  const event = (threadId: string, type: string, body: string): void => {
    sequence += 1;
    const command = `large-command-${sequence}`;
    addEvent({
      sequence,
      event_id: `large-event-${sequence}`,
      command_id: command,
      aggregate_type: "thread",
      aggregate_id: threadId,
      event_type: type,
      occurred_at: time(sequence),
      payload_json: body,
    });
    addReceipt({
      command_id: command,
      accepted_at: time(sequence),
      first_sequence: sequence,
      last_sequence: sequence,
      result_json: "{}",
    });
  };

  db.exec("BEGIN");
  for (let thread = 0; thread < threadCount; thread += 1) {
    addThread({ thread_id: `large-thread-${thread}`, created_at: time(thread), updated_at: time(thread) });
  }
  const shares = { snapshot: 0.53, mailbox: 0.094, other: 0.076, staging: 0.17, message: 0.1 };
  const sizes = { snapshot: 12_600, mailbox: 14_000, other: 1_000, staging: 10_400, message: 2_000 };
  const countOf = (kind: keyof typeof sizes) => Math.round((targetBytes * shares[kind]) / sizes[kind]);
  const counts = {
    snapshot: countOf("snapshot"),
    mailbox: countOf("mailbox"),
    other: countOf("other"),
    staging: countOf("staging"),
    message: countOf("message"),
  };
  const total = counts.snapshot + counts.mailbox + counts.other;
  let snapshots = 0;
  let mailboxes = 0;
  let others = 0;
  for (let index = 0; snapshots + mailboxes + others < total; index += 1) {
    const threadId = `large-thread-${index % threadCount}`;
    const position = (snapshots + mailboxes + others) / total;
    if (mailboxes < counts.mailbox && mailboxes / counts.mailbox <= position) {
      const body = payload(sizes.mailbox, { changedMessages: [{ id: `m-${index}` }] }, index);
      event(threadId, "conversation.mailbox-reconciled", body);
      addActivity({
        activity_id: `large-activity-${sequence}`,
        thread_id: threadId,
        activity_type: "conversation.mailbox-reconciled",
        payload_json: "{}",
        created_at: time(sequence),
        last_event_sequence: sequence,
      });
      mailboxes += 1;
      if (index % 2 === 0 && mailboxes < counts.mailbox) {
        event(threadId, "conversation.mailbox-reconciled", body);
        mailboxes += 1;
        repeatedMailboxEvents += 1;
      }
    } else if (others < counts.other && others / counts.other <= position) {
      event(threadId, "turn.item-completed", payload(sizes.other, { turnId: `t-${index}` }, index));
      others += 1;
    } else {
      event(threadId, "conversation.snapshot-updated", payload(sizes.snapshot, { snapshot: { messages: [] } }, index));
      snapshots += 1;
    }
  }
  const authors = ["user", "assistant", "assistant", "system"] as const;
  for (let index = 0; index < counts.message; index += 1) {
    const author = authors[index % authors.length] ?? "user";
    addMessage({
      thread_id: `large-thread-${index % threadCount}`,
      message_id: `large-message-${index}`,
      turn_id: index % 5 === 0 ? null : `turn-${Math.floor(index / 4)}`,
      author,
      item_type: author === "assistant" && index % 3 === 0 ? "commentary" : null,
      created_at: time(index),
      ordinal: index,
      message_json: payload(sizes.message, { exchange: { direction: index % 2 ? "incoming" : "outgoing" } }, index),
      last_event_sequence: sequence,
    });
  }
  if (addStaging && isString(sessionRow?.session_id)) {
    for (let index = 0; index < counts.staging; index += 1) {
      addStaging({
        session_id: sessionRow.session_id,
        turn_id: `turn-${Math.floor(index / 20)}`,
        item_key: `large-item-${index}`,
        item_index: index % 20,
        item_json: payload(sizes.staging, { type: "message" }, index),
        imported: index % 3 === 0 ? 0 : 1,
        updated_at: time(index),
      });
    }
  }
  db.exec("COMMIT");
  const rows = rowCounts(db);
  db.close();
  return { seconds: (performance.now() - started) / 1000, fileBytes: fileBytes(path), rows, repeatedMailboxEvents };
}

const GENERATED_ROWS: Record<string, string> = {
  orchestration_events: "event_id LIKE 'large-event-%'",
  orchestration_command_receipts: "command_id LIKE 'large-command-%'",
  projection_thread_activities: "activity_id LIKE 'large-activity-%'",
  projection_thread_messages: "message_id LIKE 'large-message-%'",
  provider_history_staging: "item_key LIKE 'large-item-%'",
};

function rowCounts(db: DatabaseSync): Record<string, number> {
  const tables = new Set(query(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name));
  const result: Record<string, number> = {};
  for (const [table, filter] of Object.entries(GENERATED_ROWS)) {
    if (!tables.has(table)) continue;
    result[table] = Number(query(db, `SELECT COUNT(*) AS n FROM ${quote(table)} WHERE ${filter}`)[0]?.n ?? 0);
  }
  return result;
}

function tableBytes(path: string): Record<string, number> {
  const db = openHarnessDatabase(path);
  const result: Record<string, number> = {};
  for (const row of query(
    db,
    "SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC LIMIT 12",
  )) {
    if (isString(row.name) && isNumber(row.bytes)) result[row.name] = row.bytes;
  }
  db.close();
  return result;
}

interface Measured<T> {
  result: T;
  peakExtraDiskBytes: number;
  peakWalBytes: number;
  fileBytesAfter: number;
}

function runChild<T>(args: readonly string[], database: string, parse: (value: unknown) => T): Promise<Measured<T>> {
  const db = openHarnessDatabase(database);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  return new Promise((resolvePromise, reject) => {
    const freeBefore = freeBytes();
    let peakExtraDiskBytes = 0;
    let peakWalBytes = 0;
    const sample = () => {
      peakExtraDiskBytes = Math.max(peakExtraDiskBytes, freeBefore - freeBytes());
      peakWalBytes = Math.max(peakWalBytes, fileBytes(`${database}-wal`));
    };
    const timer = setInterval(sample, 25);
    const child = spawn(process.execPath, [import.meta.filename, ...args], {
      env: { ...process.env, SQLITE_TMPDIR: temp, TMPDIR: temp },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearInterval(timer);
      sample();
      if (code !== 0) {
        reject(new Error(`${args.join(" ")} exited with ${code}`));
        return;
      }
      resolvePromise({
        result: parse(JSON.parse(output)),
        peakExtraDiskBytes,
        peakWalBytes,
        fileBytesAfter: fileBytes(database),
      });
    });
  });
}

function parseStart(value: unknown): StartResult {
  if (!isDynamicRecord(value) || !isDynamicRecord(value.bigTables)) throw new Error("A start printed no result.");
  return {
    seconds: Number(value.seconds),
    maxRssBytes: Number(value.maxRssBytes),
    startRssBytes: Number(value.startRssBytes),
    changedRows: Number(value.changedRows),
    version: Number(value.version),
    bigTables: Object.fromEntries(
      Object.entries(value.bigTables).map(([table, notes]) => [table, Array.isArray(notes) ? notes.map(String) : []]),
    ),
  };
}

function parseChecks(value: unknown): { foreignKeyCheckSeconds: number; quickCheckSeconds: number } {
  if (!isDynamicRecord(value)) throw new Error("The checks printed no result.");
  return {
    foreignKeyCheckSeconds: Number(value.foreignKeyCheckSeconds),
    quickCheckSeconds: Number(value.quickCheckSeconds),
  };
}

const base = join(OUT, "base.db");
const stepped = join(OUT, "stepped.db");
const oneStart = join(OUT, "one-start.db");
const copy = (from: string, to: string) => copyFileSync(from, to, constants.COPYFILE_FICLONE);

process.stderr.write(`Generating ${sizeGb} GB at schema ${fromVersion}...\n`);
const generated = generate(base);
const tablesBefore = tableBytes(base);
process.stderr.write(`Generated ${(generated.fileBytes / GIB).toFixed(2)} GB in ${generated.seconds.toFixed(0)} s.\n`);

copy(base, stepped);
const checks = await runChild([`--checks=${stepped}`], stepped, parseChecks);
const fixedSeconds = checks.result.foreignKeyCheckSeconds + checks.result.quickCheckSeconds;

const gb = (bytes: number) => Math.round((bytes / GIB) * 1000) / 1000;
const mb = (bytes: number) => Math.round(bytes / 1024 ** 2);
const steps: object[] = [];
let current = fromVersion;
for (;;) {
  const measured = await runChild([`--start=${stepped}`, `--through=${current + 1}`], stepped, parseStart);
  const { result } = measured;
  if (result.version === current) break;
  current = result.version;
  const heavy =
    Object.keys(result.bigTables).length > 0 ||
    measured.peakExtraDiskBytes > generated.fileBytes * 0.1 ||
    measured.peakWalBytes > generated.fileBytes * 0.1;
  steps.push({
    version: current,
    heavy,
    bigTables: result.bigTables,
    seconds: result.seconds,
    migrationSeconds: Math.max(0, result.seconds - fixedSeconds),
    peakExtraDiskGb: gb(measured.peakExtraDiskBytes),
    peakWalGb: gb(measured.peakWalBytes),
    maxRssMb: mb(result.maxRssBytes),
    extraRssMb: mb(result.maxRssBytes - result.startRssBytes),
    changedRows: result.changedRows,
    fileGbAfter: gb(measured.fileBytesAfter),
  });
  process.stderr.write(
    `v${current}: ${measured.result.seconds.toFixed(1)} s, disk +${(measured.peakExtraDiskBytes / GIB).toFixed(2)} GB, ` +
      `WAL ${(measured.peakWalBytes / GIB).toFixed(2)} GB, RSS ${(measured.result.maxRssBytes / 1024 ** 2).toFixed(0)} MB` +
      `${heavy ? " (heavy)" : ""}\n`,
  );
}
rmSync(stepped, { force: true });

copy(base, oneStart);
const full = await runChild([`--start=${oneStart}`, "--through=100000"], oneStart, parseStart);
const tablesAfter = tableBytes(oneStart);
const rowsAfter = (() => {
  const db = openHarnessDatabase(oneStart);
  const counts = rowCounts(db);
  db.close();
  return counts;
})();

const deletesRepeats = fromVersion < 39 && full.result.version >= 39;
const repeats = deletesRepeats ? generated.repeatedMailboxEvents : 0;
const expectedRows: Record<string, number> = {};
for (const [table, rows] of Object.entries(generated.rows)) {
  const lost = table === "projection_thread_messages" || table === "provider_history_staging" ? 0 : repeats;
  expectedRows[table] = rows - lost;
}
const failures: string[] = [];
if (full.result.version <= fromVersion) failures.push(`The upgrade stopped at version ${full.result.version}.`);
for (const [table, rows] of Object.entries(expectedRows)) {
  if (rowsAfter[table] !== rows) failures.push(`${table}: expected ${rows} rows, found ${rowsAfter[table]}`);
}

const report = {
  createdAt: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  runtime: `bun ${process.versions.bun ?? "?"}`,
  sizeGbRequested: sizeGb,
  fromVersion,
  toVersion: full.result.version,
  generated: {
    seconds: Math.round(generated.seconds),
    fileGb: gb(generated.fileBytes),
    rows: generated.rows,
    repeatedMailboxEvents: generated.repeatedMailboxEvents,
    largestObjectsGb: Object.fromEntries(Object.entries(tablesBefore).map(([name, bytes]) => [name, gb(bytes)])),
  },
  perStartChecks: {
    foreignKeyCheckSeconds: checks.result.foreignKeyCheckSeconds,
    quickCheckSeconds: checks.result.quickCheckSeconds,
  },
  oneStartUpgrade: {
    seconds: full.result.seconds,
    peakExtraDiskGb: gb(full.peakExtraDiskBytes),
    peakWalGb: gb(full.peakWalBytes),
    maxRssMb: mb(full.result.maxRssBytes),
    fileGbAfter: gb(full.fileBytesAfter),
    rowsAfter,
    largestObjectsGbAfter: Object.fromEntries(Object.entries(tablesAfter).map(([name, bytes]) => [name, gb(bytes)])),
  },
  steps,
  notes: [
    "peakExtraDisk is the drop in free space of the volume while the migration runs. Other programs that write to the same volume add noise.",
    "Each step is one start: its seconds include one foreign-key read and one quick check of the whole file (perStartChecks). migrationSeconds leaves them out.",
  ],
  failures,
};
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
rmSync(base, { force: true });
rmSync(oneStart, { force: true });
rmSync(temp, { recursive: true, force: true });
process.stderr.write(`Wrote ${join(OUT, "report.json")}\n`);
if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
