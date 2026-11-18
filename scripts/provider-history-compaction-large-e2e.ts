// Measures the compaction of imported provider history on a large database (plan 011, item 25).
//
//   bun scripts/provider-history-compaction-large-e2e.ts [--size-gb=1.6] [--vacuum]
//
// It makes a database with the latest schema and fills `provider_history_staging` to `--size-gb` in the
// proportions of a hosted server: Codex sessions whose turns are all imported 92.6%, Claude 3.7%, Codex
// sessions whose import failed 2.1% (half of their turns not imported), Grok 1.7% (half of its turns
// imported as records only). Three items are 11 MB, as the largest item of that server.
//
// Then it compacts the existing rows in a child process, through `OpenBotDatabase` and the batch loop
// that a start runs, and samples the free disk and the WAL. A second child runs the loop again, as the
// next start does. The script checks each row: an imported Codex or Claude row holds the hash of its
// old JSON, and every other row is unchanged. `--vacuum` also measures a VACUUM of the file.
//
// Writes `.openbot-build/provider-history-compaction-large/report.json` and exits non-zero when a row is
// wrong. The report holds sizes, times and counts only.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { Duration, Effect } from "effect";
import { AgentStore } from "../src/backend/agent-store";
import { compactedItemJson } from "../src/backend/database/provider-history-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase, type ProviderHistoryCompactionBatch } from "../src/backend/openbot-database";
import { compactImportedProviderHistory } from "../src/backend/provider-history-import";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-history-compaction-large");
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const BIG_ITEM_BYTES = 11 * MIB;
const ITEMS_PER_TURN = 10;
const TURNS_PER_SESSION = 3;

function flag(name: string): string | undefined {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function fileBytes(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

function freeBytes(path: string): number {
  const stats = statfsSync(path);
  return stats.bavail * stats.bsize;
}

function rows(db: DatabaseSync, sql: string, ...parameters: Array<string | number>) {
  return db
    .prepare(sql)
    .all(...parameters)
    .map((row) => {
      if (!isDynamicRecord(row)) throw new Error(`Unexpected row shape from: ${sql}`);
      return row;
    });
}

function numberOf(db: DatabaseSync, sql: string, ...parameters: Array<string | number>): number {
  const value = rows(db, sql, ...parameters)[0]?.n;
  return isNumber(value) ? value : 0;
}

// ---------------------------------------------------------------------------------------------------
// Child: open the database as a start does and run the batch compaction.

interface ChildResult {
  seconds: number;
  rows: number;
  bytes: number;
  batches: number;
  batchMs: { p50: number; p99: number; max: number };
  /** The slowest batch: its position, rows and replaced bytes. */
  slowestBatch: { index: number; rows: number; bytes: number };
}

async function runCompactionChild(root: string, pauseMs: number): Promise<ChildResult> {
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  const batchTimes: number[] = [];
  let slowestBatch = { index: -1, rows: 0, bytes: 0 };
  const timed = {
    compactImportedProviderHistory(afterRowId: number): ProviderHistoryCompactionBatch {
      const started = performance.now();
      const batch = database.compactImportedProviderHistory(afterRowId);
      const ms = performance.now() - started;
      if (ms > Math.max(0, ...batchTimes))
        slowestBatch = { index: batchTimes.length, rows: batch.rows, bytes: batch.bytes };
      batchTimes.push(ms);
      return batch;
    },
  };
  const started = performance.now();
  const result = await Effect.runPromise(compactImportedProviderHistory(timed, Duration.millis(pauseMs)));
  const seconds = (performance.now() - started) / 1000;
  database.close();
  const sorted = batchTimes.toSorted((a, b) => a - b);
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
  return { seconds, ...result, batchMs: { p50: at(0.5), p99: at(0.99), max: sorted.at(-1) ?? 0 }, slowestBatch };
}

const child = flag("child");
if (child === "compact") {
  const root = flag("root");
  if (!root) throw new Error("The child needs --root.");
  const result = await runCompactionChild(root, Number(flag("pause-ms") ?? "5"));
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------------
// Parent.

const sizeGb = Number(flag("size-gb") ?? "1.6");
if (!(sizeGb > 0)) throw new Error("Usage: bun scripts/provider-history-compaction-large-e2e.ts [--size-gb=<GB>]");
const targetBytes = sizeGb * GIB;
const vacuum = process.argv.includes("--vacuum");

rmSync(OUT, { recursive: true, force: true });
const root = join(OUT, "user-data");
const home = join(OUT, "home");
const temp = join(OUT, "tmp");
mkdirSync(root, { recursive: true });
mkdirSync(home, { recursive: true });
mkdirSync(temp, { recursive: true });
const neededBytes = targetBytes * (vacuum ? 3.5 : 2);
if (freeBytes(OUT) < neededBytes) {
  throw new Error(`This run needs ${(neededBytes / GIB).toFixed(1)} GB of free disk in ${OUT}.`);
}
const databasePath = join(root, "openbot.db");

// ----- Generate

type Group = "codexImported" | "claudeImported" | "codexFailed" | "grok";

interface GroupShape {
  provider: string;
  state: "complete" | "failed" | "active";
  share: number;
  /** Item sizes, in turn. Their mean is the mean item size of the group on the hosted server. */
  sizes: readonly number[];
  /** Whether turn `index` of a session is complete and imported. */
  imported(turnIndex: number): boolean;
}

const GROUP_NAMES: readonly Group[] = ["codexImported", "claudeImported", "codexFailed", "grok"];
const GROUPS: Record<Group, GroupShape> = {
  codexImported: {
    provider: "codex",
    state: "complete",
    share: 0.926,
    sizes: [1_200, 3_000, 6_000, 9_000, 14_000, 22_000, 27_000],
    imported: () => true,
  },
  claudeImported: {
    provider: "claude",
    state: "complete",
    share: 0.037,
    sizes: [600, 1_400, 2_200, 4_000],
    imported: () => true,
  },
  codexFailed: {
    provider: "codex",
    state: "failed",
    share: 0.021,
    sizes: [2_000, 6_000, 13_000],
    imported: (turnIndex) => turnIndex % 2 === 0,
  },
  grok: {
    provider: "grok",
    state: "active",
    share: 0.017,
    sizes: [6_000, 18_000, 30_000],
    imported: (turnIndex) => turnIndex % 2 === 0,
  },
};

const FILL = 'Lorem ipsum dolor sit amet, 界 "quoted" \\ path/to/file.ts:12 '.repeat(
  Math.ceil((BIG_ITEM_BYTES + 1024) / 60),
);
const ITEM_TYPES = ["commandExecution", "dynamicToolCall", "userMessage", "mcpToolCall", "agentMessage"] as const;

function itemJson(id: string, index: number, bytes: number): string {
  const type = ITEM_TYPES[index % ITEM_TYPES.length] ?? "agentMessage";
  const head = { type, id, status: "completed" };
  const fill = Math.max(0, bytes - JSON.stringify(head).length - 24);
  return JSON.stringify({ ...head, aggregatedOutput: FILL.slice(index % 50, (index % 50) + fill) });
}

interface Generated {
  seconds: number;
  fileBytes: number;
  sessions: Record<Group, number>;
  rows: Record<Group, number>;
  itemBytes: Record<Group, number>;
}

async function generate(): Promise<Generated> {
  const started = performance.now();
  const database = new OpenBotDatabase(root);
  const agentStore = new AgentStore(root, home, database);
  await runCauseEffect(agentStore.initialize());
  const agent = await runCauseEffect(agentStore.getOrCreate("compaction-agent", "Compaction", "Compaction"));
  const threadId = await runCauseEffect(agentStore.ensureThreadId(agent.id));
  database.close();

  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = OFF");
  const addImport = db.prepare(
    `INSERT INTO provider_history_imports
       (session_id, thread_id, provider, external_session_id, cursor_json, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
  );
  const addTurn = db.prepare(
    `INSERT INTO provider_history_turns
       (session_id, turn_id, turn_status, turn_started_at, complete, imported, updated_at)
     VALUES (?, ?, 'completed', ?, ?, ?, ?)`,
  );
  const addItem = db.prepare(
    `INSERT INTO provider_history_staging
       (session_id, turn_id, item_key, item_index, item_json, imported, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const time = new Date(Date.UTC(2026, 5, 1)).toISOString();
  const sessions: Record<Group, number> = { codexImported: 0, claudeImported: 0, codexFailed: 0, grok: 0 };
  const rowCounts: Record<Group, number> = { codexImported: 0, claudeImported: 0, codexFailed: 0, grok: 0 };
  const itemBytes: Record<Group, number> = { codexImported: 0, claudeImported: 0, codexFailed: 0, grok: 0 };
  let bigItems = 3;
  let pending = 0;
  db.exec("BEGIN");
  for (const group of GROUP_NAMES) {
    const shape = GROUPS[group];
    const groupBytes = targetBytes * shape.share;
    let item = 0;
    while (itemBytes[group] < groupBytes) {
      const sessionId = `${group}-session-${sessions[group]}`;
      sessions[group] += 1;
      addImport.run(sessionId, threadId, shape.provider, `${sessionId}-external`, shape.state, time, time);
      for (let turnIndex = 0; turnIndex < TURNS_PER_SESSION; turnIndex += 1) {
        const turnId = `${sessionId}-turn-${turnIndex}`;
        const imported = shape.imported(turnIndex) ? 1 : 0;
        addTurn.run(sessionId, turnId, turnIndex, imported, imported, time);
        for (let itemIndex = 0; itemIndex < ITEMS_PER_TURN; itemIndex += 1) {
          const big = group === "codexImported" && bigItems > 0 && item % 20_000 === 19_999;
          if (big) bigItems -= 1;
          const bytes = big ? BIG_ITEM_BYTES : (shape.sizes[item % shape.sizes.length] ?? 1_000);
          const itemKey = `${turnId}-item-${itemIndex}`;
          const json = itemJson(itemKey, item, bytes);
          addItem.run(sessionId, turnId, itemKey, itemIndex, json, imported, time);
          itemBytes[group] += Buffer.byteLength(json);
          rowCounts[group] += 1;
          item += 1;
          pending += 1;
          if (pending >= 5_000) {
            db.exec("COMMIT");
            db.exec("BEGIN");
            pending = 0;
          }
        }
      }
    }
  }
  db.exec("COMMIT");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  return {
    seconds: (performance.now() - started) / 1000,
    fileBytes: fileBytes(databasePath),
    sessions,
    rows: rowCounts,
    itemBytes,
  };
}

// ----- Inspect

const COMPACTABLE = `s.imported = 1 AND t.complete = 1 AND t.imported = 1 AND i.provider IN ('codex', 'claude')`;
const STAGING_JOIN = `provider_history_staging s
  JOIN provider_history_turns t ON t.session_id = s.session_id AND t.turn_id = s.turn_id
  JOIN provider_history_imports i ON i.session_id = s.session_id`;

interface TableSize {
  /** Pages of the table and its indexes (`dbstat`). */
  tableAndIndexBytes: number;
  /** Free bytes inside those pages. */
  unusedBytes: number;
  itemJsonBytes: number;
  rows: number;
  fileBytes: number;
  freelistBytes: number;
}

function tableSize(db: DatabaseSync): TableSize {
  const pageSize = numberOf(db, "SELECT page_size AS n FROM pragma_page_size");
  const pages = `FROM dbstat WHERE name = 'provider_history_staging' OR name LIKE 'provider_history_staging_%'
    OR name = 'sqlite_autoindex_provider_history_staging_1'`;
  return {
    tableAndIndexBytes: numberOf(db, `SELECT SUM(pgsize) AS n ${pages}`),
    unusedBytes: numberOf(db, `SELECT SUM(unused) AS n ${pages}`),
    itemJsonBytes: numberOf(db, "SELECT SUM(length(CAST(item_json AS BLOB))) AS n FROM provider_history_staging"),
    rows: numberOf(db, "SELECT COUNT(*) AS n FROM provider_history_staging"),
    fileBytes: fileBytes(databasePath),
    freelistBytes: numberOf(db, "SELECT freelist_count AS n FROM pragma_freelist_count") * pageSize,
  };
}

/** The value each row must hold after compaction, by row id. */
function expectedValues(db: DatabaseSync): { compacted: Map<number, string>; kept: Map<number, string> } {
  const compacted = new Map<number, string>();
  const kept = new Map<number, string>();
  const select = db.prepare(
    `SELECT s.rowid AS row_id, s.item_json, (${COMPACTABLE}) AS compactable FROM ${STAGING_JOIN} ORDER BY s.rowid`,
  );
  for (const row of select.iterate()) {
    if (!isDynamicRecord(row) || !isNumber(row.row_id) || !isString(row.item_json)) throw new Error("Bad row.");
    if (row.compactable === 1) compacted.set(row.row_id, compactedItemJson(row.item_json));
    else kept.set(row.row_id, createHash("sha256").update(row.item_json).digest("hex"));
  }
  return { compacted, kept };
}

function verify(db: DatabaseSync, expected: ReturnType<typeof expectedValues>) {
  let compactedRight = 0;
  let keptRight = 0;
  let wrong = 0;
  let missing = 0;
  for (const row of db.prepare("SELECT rowid AS row_id, item_json FROM provider_history_staging").iterate()) {
    if (!isDynamicRecord(row) || !isNumber(row.row_id) || !isString(row.item_json)) throw new Error("Bad row.");
    const hash = expected.compacted.get(row.row_id);
    if (hash !== undefined) {
      if (row.item_json === hash) compactedRight += 1;
      else wrong += 1;
      continue;
    }
    const keptHash = expected.kept.get(row.row_id);
    if (keptHash === undefined) missing += 1;
    else if (createHash("sha256").update(row.item_json).digest("hex") === keptHash) keptRight += 1;
    else wrong += 1;
  }
  return {
    compactedRight,
    keptRight,
    wrong,
    missing,
    expectedCompacted: expected.compacted.size,
    expectedKept: expected.kept.size,
  };
}

// ----- Measure

interface Measured<T> {
  result: T;
  peakExtraDiskBytes: number;
  peakWalBytes: number;
  walBytesAfter: number;
}

function parseChildResult(value: unknown): ChildResult {
  if (!isDynamicRecord(value) || !isDynamicRecord(value.batchMs)) throw new Error("The child printed no result.");
  return {
    seconds: Number(value.seconds),
    rows: Number(value.rows),
    bytes: Number(value.bytes),
    batches: Number(value.batches),
    batchMs: { p50: Number(value.batchMs.p50), p99: Number(value.batchMs.p99), max: Number(value.batchMs.max) },
    slowestBatch: isDynamicRecord(value.slowestBatch)
      ? {
          index: Number(value.slowestBatch.index),
          rows: Number(value.slowestBatch.rows),
          bytes: Number(value.slowestBatch.bytes),
        }
      : { index: -1, rows: 0, bytes: 0 },
  };
}

function runChild(pauseMs: number): Promise<Measured<ChildResult>> {
  return new Promise((resolvePromise, reject) => {
    const freeBefore = freeBytes(OUT);
    let peakExtraDiskBytes = 0;
    let peakWalBytes = 0;
    const sample = () => {
      peakExtraDiskBytes = Math.max(peakExtraDiskBytes, freeBefore - freeBytes(OUT));
      peakWalBytes = Math.max(peakWalBytes, fileBytes(`${databasePath}-wal`));
    };
    const timer = setInterval(sample, 25);
    const compaction = spawn(
      process.execPath,
      [import.meta.filename, "--child=compact", `--root=${root}`, `--pause-ms=${pauseMs}`],
      { env: { ...process.env, SQLITE_TMPDIR: temp, TMPDIR: temp }, stdio: ["ignore", "pipe", "inherit"] },
    );
    let output = "";
    compaction.stdout.setEncoding("utf8");
    compaction.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    compaction.on("error", reject);
    compaction.on("close", (code) => {
      clearInterval(timer);
      sample();
      if (code !== 0) {
        reject(new Error(`The compaction child exited with ${code}.`));
        return;
      }
      resolvePromise({
        result: parseChildResult(JSON.parse(output)),
        peakExtraDiskBytes,
        peakWalBytes,
        walBytesAfter: fileBytes(`${databasePath}-wal`),
      });
    });
  });
}

const generated = await generate();
const inspect = new DatabaseSync(databasePath);
const before = tableSize(inspect);
const groupsBefore = rows(
  inspect,
  `SELECT i.provider, i.state, (${COMPACTABLE}) AS compactable, COUNT(*) AS rows,
          SUM(length(CAST(s.item_json AS BLOB))) AS bytes
   FROM ${STAGING_JOIN} GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
);
const expected = expectedValues(inspect);
inspect.close();

// On a real computer the file is on disk long before the start. Write the generated pages to disk
// now, so the first checkpoint of the compaction does not wait for them.
spawnSync("sync");
const first = await runChild(5);
const repeat = await runChild(5);

const after = new DatabaseSync(databasePath);
const check = verify(after, expected);
const sizeAfter = tableSize(after);
after.close();

let vacuumResult: { seconds: number; fileBytesAfter: number; peakExtraDiskBytes: number } | null = null;
if (vacuum) {
  const db = new DatabaseSync(databasePath);
  const freeBefore = freeBytes(OUT);
  let peakExtraDiskBytes = 0;
  const timer = setInterval(() => {
    peakExtraDiskBytes = Math.max(peakExtraDiskBytes, freeBefore - freeBytes(OUT));
  }, 25);
  const started = performance.now();
  db.exec("VACUUM");
  const seconds = (performance.now() - started) / 1000;
  clearInterval(timer);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  vacuumResult = { seconds, fileBytesAfter: fileBytes(databasePath), peakExtraDiskBytes };
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  command: process.argv.join(" "),
  sizeGb,
  generated,
  groupsBefore,
  before,
  firstStart: first,
  nextStart: repeat,
  after: sizeAfter,
  vacuum: vacuumResult,
  check,
  acceptance: {
    databaseAtLeast1_5Gb: generated.fileBytes >= 1.5 * 1e9,
    everyImportedCodexAndClaudeRowHoldsItsHash:
      check.compactedRight === check.expectedCompacted && check.expectedCompacted > 0,
    everyOtherRowUnchanged: check.keptRight === check.expectedKept && check.expectedKept > 0,
    noWrongOrMissingRow: check.wrong === 0 && check.missing === 0,
    firstStartCompactedEveryRow: first.result.rows === check.expectedCompacted,
    nextStartCompactsNothing: repeat.result.rows === 0,
    // An UPDATE leaves the page of each large item almost empty (about 80% unused in total).
    compactedPagesAreNotLeftEmpty: sizeAfter.unusedBytes < sizeAfter.tableAndIndexBytes * 0.25,
  },
};
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
rmSync(root, { recursive: true, force: true });
rmSync(home, { recursive: true, force: true });
rmSync(temp, { recursive: true, force: true });
const failed = Object.entries(report.acceptance).flatMap(([name, passed]) => (passed ? [] : [name]));
if (failed.length > 0) throw new Error(`Provider history compaction check failed: ${failed.join(", ")}.`);
process.stdout.write(`Provider history compaction check passed. Wrote ${join(OUT, "report.json")}.\n`);
