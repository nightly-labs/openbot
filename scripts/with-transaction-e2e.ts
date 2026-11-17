// Checks the one SQLite transaction helper (`withTransaction`, plan 011 item 10) on a real
// `openbot.db`: a forced error inside nested writes leaves no partial write, a caught nested error
// rolls back only its own level, a full disk keeps its own error, and the connection is never left in
// a transaction and stays usable. Boots the real database on a temporary profile. No app, provider,
// account or network is started.
//
// Run: bun scripts/with-transaction-e2e.ts
// Writes .openbot-build/with-transaction/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { databaseRows, requiredNumberColumn, requiredStringColumn } from "../src/backend/database/database-rows";
import { withTransaction, withTransactionAsync } from "../src/backend/database/sqlite-transaction";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { workflowTransaction } from "../src/backend/workflows/workflow-transaction";

const OUT = resolve(import.meta.dirname, "../.openbot-build/with-transaction");
const root = await mkdtemp(join(tmpdir(), "openbot-with-transaction-"));
const userData = join(root, "user-data");

interface CaseResult {
  name: string;
  rows: string[];
  inTransactionAfter: boolean;
  error?: string;
}

interface Report {
  cases: CaseResult[];
  integrityCheck?: string;
  reopenedRows?: string[];
  passed: boolean;
  failure?: string;
}

const report: Report = { cases: [], passed: false };

class ForcedFailure extends Error {}

function rowsOf(database: OpenBotDatabase): string[] {
  return databaseRows(database.connection.prepare("SELECT label FROM with_transaction_probe ORDER BY id").all()).map(
    (row) => requiredStringColumn(row, "label"),
  );
}

function write(database: OpenBotDatabase, label: string): void {
  database.connection.prepare("INSERT INTO with_transaction_probe(label) VALUES (?)").run(label);
}

function clear(database: OpenBotDatabase): void {
  database.connection.exec("DELETE FROM with_transaction_probe");
}

function record(database: OpenBotDatabase, name: string, run: () => void): CaseResult {
  clear(database);
  let error: string | undefined;
  try {
    run();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  const result: CaseResult = {
    name,
    rows: rowsOf(database),
    inTransactionAfter: database.connection.isTransaction,
    ...(error === undefined ? {} : { error }),
  };
  report.cases.push(result);
  return result;
}

function eventCount(database: OpenBotDatabase, commandId: string): number {
  const rows = databaseRows(
    database.connection
      .prepare(
        `SELECT (SELECT count(*) FROM orchestration_events WHERE command_id = ?) +
                (SELECT count(*) FROM orchestration_command_receipts WHERE command_id = ?) AS count`,
      )
      .all(commandId, commandId),
  );
  return rows[0] ? requiredNumberColumn(rows[0], "count") : 0;
}

try {
  const database = new OpenBotDatabase(userData);
  await runCauseEffect(database.initialize());
  database.connection.exec("CREATE TABLE with_transaction_probe(id INTEGER PRIMARY KEY, label TEXT NOT NULL)");

  // 1. Nested writes that succeed commit together.
  const nestedCommit = record(database, "nested writes commit together", () =>
    withTransaction(database.connection, () => {
      write(database, "outer");
      withTransaction(database.connection, () => {
        write(database, "inner");
        withTransaction(database.connection, () => write(database, "innermost"));
      });
    }),
  );
  assert.deepEqual(nestedCommit.rows, ["outer", "inner", "innermost"]);
  assert.equal(nestedCommit.inTransactionAfter, false);

  // 2. An error in the innermost write that nobody catches leaves no row of any level.
  const uncaught = record(database, "uncaught nested error rolls back every level", () =>
    withTransaction(database.connection, () => {
      write(database, "outer");
      withTransaction(database.connection, () => {
        write(database, "inner");
        withTransaction(database.connection, () => {
          write(database, "innermost");
          throw new ForcedFailure("forced innermost failure");
        });
      });
    }),
  );
  assert.deepEqual(uncaught.rows, []);
  assert.equal(uncaught.error, "forced innermost failure");
  assert.equal(uncaught.inTransactionAfter, false);

  // 3. A caught nested error rolls back only its level: the caller keeps its own writes.
  const caught = record(database, "caught nested error rolls back only its level", () =>
    withTransaction(database.connection, () => {
      write(database, "outer-before");
      try {
        withTransaction(database.connection, () => {
          write(database, "inner-partial");
          withTransaction(database.connection, () => write(database, "innermost-partial"));
          throw new ForcedFailure("forced inner failure");
        });
      } catch (error) {
        if (!(error instanceof ForcedFailure)) throw error;
      }
      write(database, "outer-after");
    }),
  );
  assert.deepEqual(caught.rows, ["outer-before", "outer-after"]);
  assert.equal(caught.inTransactionAfter, false);

  // 4. A SQLite constraint error inside a nested level keeps its own message.
  database.connection.exec("CREATE UNIQUE INDEX with_transaction_probe_label ON with_transaction_probe(label)");
  const constraint = record(database, "constraint error inside a nested level keeps its message", () =>
    withTransaction(database.connection, () => {
      write(database, "unique");
      withTransaction(database.connection, () => write(database, "unique"));
    }),
  );
  assert.deepEqual(constraint.rows, []);
  assert.match(constraint.error ?? "", /UNIQUE constraint failed/);
  assert.equal(constraint.inTransactionAfter, false);
  database.connection.exec("DROP INDEX with_transaction_probe_label");

  // 5. A full disk inside a nested write: the first error is thrown, nothing stays, no transaction stays.
  const pageCount = requiredNumberColumn(
    databaseRows(database.connection.prepare("PRAGMA page_count").all())[0] ?? {},
    "page_count",
  );
  const fullDisk = record(database, "full disk inside a nested write keeps its own error", () => {
    database.connection.exec(`PRAGMA max_page_count = ${pageCount + 2}`);
    try {
      withTransaction(database.connection, () => {
        write(database, "before-full");
        withTransaction(database.connection, () => {
          const insert = database.connection.prepare("INSERT INTO with_transaction_probe(label) VALUES (?)");
          for (let index = 0; index < 10_000; index += 1) insert.run(`filler-${index}-${"x".repeat(512)}`);
        });
      });
    } finally {
      database.connection.exec("PRAGMA max_page_count = 1073741823");
    }
  });
  assert.deepEqual(fullDisk.rows, []);
  assert.match(fullDisk.error ?? "", /full/i);
  assert.equal(fullDisk.inTransactionAfter, false);

  // 6. A real store path: a dispatch nested in a workflow transaction whose projector fails keeps no
  // event and no receipt.
  const commandId = "with-transaction-e2e:dispatch";
  const dispatch = record(database, "failed nested dispatch keeps no event or receipt", () =>
    workflowTransaction(database, () => {
      write(database, "workflow-row");
      database.dispatch(
        commandId,
        [{ aggregateType: "with-transaction-e2e", aggregateId: "probe", eventType: "probe.written", payload: {} }],
        () => {
          write(database, "projected-row");
          throw new ForcedFailure("forced projector failure");
        },
      );
    }),
  );
  assert.deepEqual(dispatch.rows, []);
  assert.equal(eventCount(database, commandId), 0);
  assert.equal(dispatch.inTransactionAfter, false);

  // 7. Async work that fails after an await rolls back, and an async transaction never nests.
  clear(database);
  let asyncError = "";
  await withTransactionAsync(database.connection, async () => {
    write(database, "async-before");
    await Promise.resolve();
    throw new ForcedFailure("forced async failure");
  }).catch((error: unknown) => {
    asyncError = error instanceof Error ? error.message : String(error);
  });
  report.cases.push({
    name: "async failure after an await rolls back",
    rows: rowsOf(database),
    inTransactionAfter: database.connection.isTransaction,
    error: asyncError,
  });
  assert.deepEqual(rowsOf(database), []);
  assert.equal(asyncError, "forced async failure");
  assert.equal(database.connection.isTransaction, false);

  // The refusal is a rejected promise: the async work never runs, and the open transaction is kept.
  let refusal: Promise<string> = Promise.resolve("");
  const asyncNested = record(database, "async transaction inside an open one is refused", () =>
    withTransaction(database.connection, () => {
      write(database, "outer");
      refusal = withTransactionAsync(database.connection, async () => write(database, "async-inner")).then(
        () => "",
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
    }),
  );
  asyncNested.error = await refusal;
  assert.deepEqual(asyncNested.rows, ["outer"]);
  assert.match(asyncNested.error, /within a transaction/);
  assert.equal(asyncNested.inTransactionAfter, false);

  // 8. The connection stays usable: a later write commits, and the file is sound after a reopen.
  const usable = record(database, "connection is usable after the failures", () =>
    withTransaction(database.connection, () => write(database, "after-failures")),
  );
  assert.deepEqual(usable.rows, ["after-failures"]);
  report.integrityCheck = requiredStringColumn(
    databaseRows(database.connection.prepare("PRAGMA integrity_check").all())[0] ?? {},
    "integrity_check",
  );
  assert.equal(report.integrityCheck, "ok");
  database.close();

  const reopened = new OpenBotDatabase(userData);
  await runCauseEffect(reopened.initialize());
  report.reopenedRows = rowsOf(reopened);
  assert.deepEqual(report.reopenedRows, ["after-failures"]);
  reopened.close();

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(
    `${report.passed ? "PASS" : "FAIL"}: ${report.cases.length} cases, report in ${join(OUT, "report.json")}\n`,
  );
  if (report.failure) process.stderr.write(`${report.failure}\n`);
}
