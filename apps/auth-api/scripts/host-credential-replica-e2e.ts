import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect, Exit } from "effect";
import { RemoteControlPlane } from "../src/server/remote-control-plane";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "host-credential-replica-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

const ticketKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const ticketKeys = {
  REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({
    ...(await crypto.subtle.exportKey("jwk", ticketKeyPair.privateKey)),
    kid: "ticket-1",
  }),
  REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({
    keys: [{ ...(await crypto.subtle.exportKey("jwk", ticketKeyPair.publicKey)), kid: "ticket-1" }],
  }),
  REMOTE_TICKET_KEY_ID: "ticket-1",
};

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of (await readdir(MIGRATIONS)).sort()) database.exec(await readFile(join(MIGRATIONS, name), "utf8"));
  database
    .prepare(
      "INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES ('owner', 'email:owner', ?, 1, 1)",
    )
    .run("owner@example.test");
  return database;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function storeHost(database: DatabaseSync, hostId: string, token: string | null) {
  database
    .prepare(
      `INSERT INTO remote_hosts(host_id, owner_user_id, name, machine_token_hash, created_at, updated_at)
       VALUES (?, 'owner', 'Host', ?, 1, 1)
       ON CONFLICT(host_id) DO UPDATE SET machine_token_hash = excluded.machine_token_hash`,
    )
    .run(hostId, token === null ? null : tokenHash(token));
}

function countingD1(database: DatabaseSync, reads: string[], label: string): D1Database {
  const source = sqliteD1(database);
  return {
    prepare: (query: string) => {
      if (query.includes("FROM remote_hosts")) reads.push(label);
      return source.prepare(query);
    },
    batch: (statements) => source.batch(statements),
    exec: (query) => source.exec(query),
    withSession: (constraint) => source.withSession(constraint),
    dump: () => source.dump(),
  };
}

function withStaleReplica(primary: DatabaseSync, replica: DatabaseSync, reads: string[]): D1Database {
  const primaryD1 = countingD1(primary, reads, "primary");
  const replicaD1 = countingD1(replica, reads, "replica");
  return {
    prepare: (query) => primaryD1.prepare(query),
    batch: (statements) => primaryD1.batch(statements),
    exec: (query) => primaryD1.exec(query),
    withSession: () => ({
      prepare: (query) => replicaD1.prepare(query),
      batch: (statements) => replicaD1.batch(statements),
      getBookmark: () => null,
    }),
    dump: () => primaryD1.dump(),
  };
}

async function credentialAccepted(plane: RemoteControlPlane, hostId: string, token: string): Promise<boolean> {
  const exit = await Effect.runPromiseExit(plane.assertHostCredential(hostId, token));
  return Exit.isSuccess(exit);
}

async function scenario() {
  const primary = await migratedDatabase();
  const replica = await migratedDatabase();
  const reads: string[] = [];
  const plane = new RemoteControlPlane({ DB: withStaleReplica(primary, replica, reads), ...ticketKeys });
  const readsFor = async (hostId: string, token: string) => {
    reads.length = 0;
    const accepted = await credentialAccepted(plane, hostId, token);
    return { accepted, reads: [...reads] };
  };

  storeHost(primary, "synced", "token-synced");
  storeHost(replica, "synced", "token-synced");
  const synced = await readsFor("synced", "token-synced");
  check(
    "a host that the replica knows is accepted with one replica read",
    synced.accepted && synced.reads.join() === "replica",
    synced,
  );

  storeHost(primary, "new", "token-new");
  const fresh = await readsFor("new", "token-new");
  check(
    "a host that is only on the primary is accepted after the primary read",
    fresh.accepted && fresh.reads.join() === "replica,primary",
    fresh,
  );

  storeHost(primary, "rotated", "token-after");
  storeHost(replica, "rotated", "token-before");
  const rotated = await readsFor("rotated", "token-after");
  check(
    "a rotated token that the replica does not have yet is accepted from the primary",
    rotated.accepted && rotated.reads.join() === "replica,primary",
    rotated,
  );

  const wrong = await readsFor("synced", "token-wrong");
  check(
    "a wrong token is refused after the primary read",
    !wrong.accepted && wrong.reads.join() === "replica,primary",
    wrong,
  );

  const missing = await readsFor("missing", "token-missing");
  check("an unknown host is refused", !missing.accepted && missing.reads.join() === "replica,primary", missing);

  storeHost(primary, "cleared", null);
  storeHost(replica, "cleared", null);
  const cleared = await readsFor("cleared", "");
  check("a host with no token refuses an empty token", !cleared.accepted, cleared);

  const full = new RemoteControlPlane({ DB: withStaleReplica(primary, replica, reads), ...ticketKeys });
  reads.length = 0;
  const authenticated = await Effect.runPromiseExit(full.authenticateHost("rotated", "token-after"));
  check("authenticateHost still reads only the primary", Exit.isSuccess(authenticated) && reads.join() === "primary", {
    reads: [...reads],
  });
}

try {
  await scenario();
} catch (error) {
  check("scenario", false, { error: error instanceof Error ? error.message : String(error) });
}

await mkdir(OUT, { recursive: true });
const report = { passed: checks.length > 0 && checks.every((entry) => entry.passed), checks };
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const entry of checks) console.log(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!report.passed) process.exitCode = 1;
