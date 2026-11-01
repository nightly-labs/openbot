// Checks the file names of the account database migrations before Wrangler applies them.
// Run: bun apps/auth-api/scripts/migration-numbers.ts
//
// Wrangler applies `migrations/*.sql` in name order and records each applied name. Two pull
// requests that pick the same next number both pass review, and after both merge the order of the
// pair depends on the rest of the name. Gaps are allowed: a closed pull request can leave one.

import { readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_NAME = /^(\d{4})_[a-z0-9_]+\.sql$/u;

// Both 0034 migrations are applied in production. An applied migration keeps its name, so this
// pair stays allowed, and only this pair.
const APPLIED_DUPLICATES: ReadonlyMap<string, readonly string[]> = new Map([
  ["0034", ["0034_account_attribution.sql", "0034_server_claims.sql"]],
]);

export function migrationNumberProblems(names: readonly string[]): string[] {
  const problems: string[] = [];
  const byNumber = new Map<string, string[]>();
  for (const name of [...names].sort()) {
    const number = MIGRATION_NAME.exec(name)?.[1];
    if (!number) {
      problems.push(`${name}: expected four digits, an underscore, a lowercase name, and .sql`);
      continue;
    }
    byNumber.set(number, [...(byNumber.get(number) ?? []), name]);
  }
  for (const [number, sameNumber] of byNumber) {
    if (sameNumber.length < 2) continue;
    const allowed = APPLIED_DUPLICATES.get(number);
    if (allowed && sameNumber.length === allowed.length && sameNumber.every((name) => allowed.includes(name))) continue;
    problems.push(`${number}: used by ${sameNumber.join(", ")}. Give the newer migration the next free number.`);
  }
  return problems;
}

export const migrationsDirectory = join(import.meta.dirname, "..", "migrations");

if (import.meta.main) {
  const problems = migrationNumberProblems(readdirSync(migrationsDirectory));
  if (problems.length > 0) {
    process.stderr.write(`Migration names in ${migrationsDirectory}:\n${problems.map((p) => `- ${p}`).join("\n")}\n`);
    process.exit(1);
  }
}
