// Checks the account database migration names and the rules of the checker.
// Run: bun scripts/auth-migration-numbers-smoke.ts
// It writes .openbot-build/auth-migration-numbers.json and exits non-zero on a failure.

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { migrationNumberProblems, migrationsDirectory } from "../apps/auth-api/scripts/migration-numbers";

const outputPath = join(import.meta.dirname, "..", ".openbot-build", "auth-migration-numbers.json");
const checks: { name: string; passed: boolean; detail?: unknown }[] = [];

function check(name: string, run: () => unknown): void {
  try {
    checks.push({ name, passed: true, detail: run() });
  } catch (error) {
    checks.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

check("the repository migrations have unique numbers", () => {
  const names = readdirSync(migrationsDirectory);
  assert.deepEqual(migrationNumberProblems(names), []);
  return { migrations: names.length, latest: [...names].sort().at(-1) };
});

check("the applied 0034 pair stays allowed", () => {
  assert.deepEqual(
    migrationNumberProblems(["0033_a.sql", "0034_server_claims.sql", "0034_account_attribution.sql"]),
    [],
  );
  return { allowed: "0034" };
});

check("a third 0034 migration is refused", () => {
  const problems = migrationNumberProblems([
    "0034_account_attribution.sql",
    "0034_server_claims.sql",
    "0034_new_table.sql",
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /^0034: used by /u);
  return problems;
});

check("two new migrations with one number are refused", () => {
  const problems = migrationNumberProblems(["0046_remote_session_indexes.sql", "0047_a.sql", "0047_b.sql"]);
  assert.deepEqual(problems, ["0047: used by 0047_a.sql, 0047_b.sql. Give the newer migration the next free number."]);
  return problems;
});

check("a malformed name is refused", () => {
  const problems = migrationNumberProblems(["47_short.sql", "0048_Upper.sql", "0049_notes.txt"]);
  assert.equal(problems.length, 3);
  return problems;
});

check("a gap is allowed", () => {
  assert.deepEqual(migrationNumberProblems(["0001_first.sql", "0003_third.sql"]), []);
  return { gap: "0002" };
});

const report = { generatedAt: new Date().toISOString(), checks, passed: checks.every((item) => item.passed) };
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Auth migration numbers report: ${outputPath}\n`);
if (!report.passed) process.exitCode = 1;
