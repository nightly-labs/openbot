import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { withDatabaseTransaction } from "../src/backend/agent/conversation-runtime";
import { databaseRows, requiredNumberColumn, requiredStringColumn } from "../src/backend/database/database-rows";
import { withTransaction, withTransactionAsync } from "../src/backend/database/sqlite-transaction";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/with-transaction");
const root = await mkdtemp(join(tmpdir(), "openbot-with-transaction-"));
const userData = join(root, "user-data");

interface CaseResult {
  name: string;
  rows: string[];
  inTransactionAfter: boolean;
  error?: string;
  effects?: string[];
}

const report: { cases: CaseResult[]; reopenedRows?: string[]; passed: boolean; failure?: string } = {
  cases: [],
  passed: false,
};

class ForcedFailure extends Error {}

const database = new OpenBotDatabase(userData);
const db = () => database.connection;
const write = (label: string) => db().prepare("INSERT INTO probe(label) VALUES (?)").run(label);
const rowsOf = (target: OpenBotDatabase) =>
  databaseRows(target.connection.prepare("SELECT label FROM probe ORDER BY id").all()).map((row) =>
    requiredStringColumn(row, "label"),
  );
const pragma = (name: string) => databaseRows(db().prepare(`PRAGMA ${name}`).all())[0] ?? {};

async function check(name: string, run: () => unknown, rows: string[], error?: RegExp): Promise<CaseResult> {
  db().exec("DELETE FROM probe");
  let message: string | undefined;
  try {
    await run();
  } catch (cause) {
    message = cause instanceof Error ? cause.message : String(cause);
  }
  const result: CaseResult = { name, rows: rowsOf(database), inTransactionAfter: db().isTransaction };
  if (message !== undefined) result.error = message;
  report.cases.push(result);
  assert.deepEqual(result.rows, rows, name);
  assert.equal(result.inTransactionAfter, false, name);
  if (error) assert.match(message ?? "", error, name);
  else assert.equal(message, undefined, name);
  return result;
}

function nested(labels: string[], fail: boolean): void {
  const [label, ...rest] = labels;
  if (label === undefined) {
    if (fail) throw new ForcedFailure("forced failure");
    return;
  }
  withTransaction(db(), () => {
    write(label);
    nested(rest, fail);
  });
}

try {
  await runCauseEffect(database.initialize());
  db().exec("CREATE TABLE probe(id INTEGER PRIMARY KEY, label TEXT NOT NULL)");

  const levels = ["outer", "inner", "innermost"];
  await check("nested writes commit together", () => nested(levels, false), levels);
  await check("uncaught nested error rolls back every level", () => nested(levels, true), [], /forced failure/);
  await check(
    "caught nested error rolls back only its level",
    () =>
      withTransaction(db(), () => {
        write("outer-before");
        try {
          nested(["inner", "innermost"], true);
        } catch (error) {
          if (!(error instanceof ForcedFailure)) throw error;
        }
        write("outer-after");
      }),
    ["outer-before", "outer-after"],
  );

  const pageCount = requiredNumberColumn(pragma("page_count"), "page_count");
  await check(
    "full disk inside a nested write keeps its own error",
    () => {
      db().exec(`PRAGMA max_page_count = ${pageCount + 2}`);
      try {
        withTransaction(db(), () => {
          write("before-full");
          withTransaction(db(), () => {
            for (let index = 0; index < 10_000; index += 1) write(`filler-${index}-${"x".repeat(512)}`);
          });
        });
      } finally {
        db().exec("PRAGMA max_page_count = 1073741823");
      }
    },
    [],
    /full/i,
  );

  await check(
    "async failure after an await rolls back",
    () =>
      withTransactionAsync(db(), async () => {
        write("async-before");
        await Promise.resolve();
        throw new ForcedFailure("forced async failure");
      }),
    [],
    /forced async failure/,
  );
  await check(
    "async transaction inside an open one is refused",
    () => {
      let refusal: Promise<void> = Promise.resolve();
      withTransaction(db(), () => {
        write("outer");
        refusal = withTransactionAsync(db(), async () => void write("async-inner"));
      });
      return refusal;
    },
    ["outer"],
    /within a transaction/,
  );

  const effects: string[] = [];
  const effect = (name: string) => () => void effects.push(name);
  const queue = await check(
    "caught nested failure drops the effects of its level",
    () =>
      withDatabaseTransaction(
        database,
        () => {
          write("outer");
          withDatabaseTransaction(database, () => write("kept"), effect("kept:rollback"), effect("kept:commit"));
          try {
            withDatabaseTransaction(
              database,
              () => {
                write("middle");
                withDatabaseTransaction(
                  database,
                  () => write("inner"),
                  effect("inner:rollback"),
                  effect("inner:commit"),
                );
                throw new ForcedFailure("forced middle failure");
              },
              effect("middle:rollback"),
              effect("middle:commit"),
            );
          } catch (error) {
            if (!(error instanceof ForcedFailure)) throw error;
          }
        },
        effect("outer:rollback"),
        effect("outer:commit"),
      ),
    ["outer", "kept"],
  );
  queue.effects = effects;
  assert.deepEqual(effects, ["inner:rollback", "middle:rollback", "kept:commit", "outer:commit"]);

  await check("connection is usable after the failures", () => withTransaction(db(), () => write("after")), ["after"]);
  assert.equal(requiredStringColumn(pragma("integrity_check"), "integrity_check"), "ok");
  database.close();

  const reopened = new OpenBotDatabase(userData);
  await runCauseEffect(reopened.initialize());
  report.reopenedRows = rowsOf(reopened);
  reopened.close();
  assert.deepEqual(report.reopenedRows, ["after"]);

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(
    `${report.passed ? "PASS" : "FAIL"}: ${report.cases.length} cases, ${join(OUT, "report.json")}\n`,
  );
  if (report.failure) process.stderr.write(`${report.failure}\n`);
}
