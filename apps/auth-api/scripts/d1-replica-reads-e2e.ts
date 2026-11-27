import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { D1AuthRepository } from "../src/server/d1-auth-repository";
import { observedD1, withD1ReplicaReads } from "../src/server/observed-d1";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "d1-replica-reads-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const NOW = Date.parse("2026-11-27T13:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const AFTER_ACTIVITY_INTERVAL = NOW + 16 * 60_000;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function addSession(database: DatabaseSync, id: string, userId: string, token: string): void {
  database
    .prepare(
      "INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(id, userId, tokenHash(token), NOW + DAY_MS, NOW, NOW);
}

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  database
    .prepare("INSERT INTO users(id, identity_key, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)")
    .run("user", "email:user", "user@example.test", "Old name");
  addSession(database, "old-session", "user", "old-token");
  return database;
}

interface ReplicaCounts {
  replica: number;
  primary: number;
}

function laggingReplicaD1(primary: DatabaseSync, replica: DatabaseSync, counts: ReplicaCounts): D1Database {
  const primaryD1 = sqliteD1(primary);
  const replicaD1 = sqliteD1(replica);
  const countedPrepare =
    (target: D1Database, key: keyof ReplicaCounts) =>
    (query: string): D1PreparedStatement => {
      counts[key] += 1;
      return target.prepare(query);
    };
  const session: D1DatabaseSession = {
    prepare: (query: string) =>
      /^\s*SELECT\b/iu.test(query) ? countedPrepare(replicaD1, "replica")(query) : primaryD1.prepare(query),
    batch: (statements) => primaryD1.batch(statements),
    getBookmark: () => null,
  };
  return {
    prepare: countedPrepare(primaryD1, "primary"),
    batch: (statements) => primaryD1.batch(statements),
    exec: (query) => primaryD1.exec(query),
    withSession: () => session,
    dump: () => primaryD1.dump(),
  };
}

async function main() {
  const primary = migratedDatabase();
  const replica = migratedDatabase();
  addSession(primary, "new-session", "user", "new-token");
  primary.prepare("UPDATE users SET name = 'New name' WHERE id = 'user'").run();

  const counts: ReplicaCounts = { replica: 0, primary: 0 };
  const repository = new D1AuthRepository(observedD1(laggingReplicaD1(primary, replica, counts)));

  const outside = await Effect.runPromise(repository.authenticate("old-token", NOW));
  check(
    "a request with no replica scope reads the primary only",
    outside?.name === "New name" && counts.replica === 0,
    {
      name: outside?.name ?? null,
      counts: { ...counts },
    },
  );

  const replicaRead = await withD1ReplicaReads(() =>
    Effect.runPromise(repository.authenticateDesktopSession("old-token", AFTER_ACTIVITY_INTERVAL)),
  );
  check(
    "a request in the replica scope reads the replica through the Effect runtime",
    replicaRead?.name === "Old name" && counts.replica === 1,
    { name: replicaRead?.name ?? null, counts: { ...counts } },
  );

  const primaryBefore = counts.primary;
  const newSession = await withD1ReplicaReads(() =>
    Effect.runPromise(repository.authenticate("new-token", AFTER_ACTIVITY_INTERVAL + 20_000)),
  );
  check(
    "a session that the replica does not have yet is read from the primary, so a new sign-in is not refused",
    newSession?.id === "user" && counts.replica === 2 && counts.primary > primaryBefore,
    { user: newSession?.id ?? null, counts: { ...counts } },
  );

  const missing = await withD1ReplicaReads(() =>
    Effect.runPromise(repository.authenticate("no-token", AFTER_ACTIVITY_INTERVAL + 40_000)),
  );
  check("an unknown session is still refused after the primary read", missing === null, { counts: { ...counts } });

  const touched = primary
    .prepare("SELECT last_used_at FROM auth_sessions WHERE id = 'old-session'")
    .get()?.last_used_at;
  check("the activity update in the replica scope writes to the primary", touched === AFTER_ACTIVITY_INTERVAL, {
    touched,
  });

  const passed = checks.every((entry) => entry.passed);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
  for (const entry of checks) console.log(`${entry.passed ? "ok" : "FAIL"} ${entry.name}`);
  if (!passed) process.exit(1);
}

await main();
