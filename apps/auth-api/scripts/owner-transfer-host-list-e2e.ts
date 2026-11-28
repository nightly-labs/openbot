import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { decodeIncomingOwnerTransfers, decodeListedOwnerTransfers } from "@openbot/contracts/owner-transfer";
import { Effect } from "effect";
import { observedD1 } from "../src/server/observed-d1";
import { RemoteControlPlane } from "../src/server/remote-control-plane";
import type { AuthUser } from "../src/server/types";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "owner-transfer-host-list-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const NOW = Date.parse("2026-11-28T10:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const RECIPIENT_EMAIL = "recipient@example.test";

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of (await readdir(MIGRATIONS)).sort()) database.exec(await readFile(join(MIGRATIONS, name), "utf8"));
  return database;
}

interface D1Counts {
  statements: number;
  batches: number;
  queries: string[];
}

function countedD1(database: DatabaseSync, counts: D1Counts): D1Database {
  const source = sqliteD1(database);
  const counted = (statement: D1PreparedStatement): D1PreparedStatement => {
    const { bind, first, all, run } = statement;
    statement.bind = (...values: unknown[]) => counted(bind(...values));
    statement.first = <T>(column?: string) => {
      counts.statements += 1;
      return column === undefined ? first<T>() : first<T>(column);
    };
    statement.all = <T>() => {
      counts.statements += 1;
      return all<T>();
    };
    statement.run = <T>() => {
      counts.statements += 1;
      return run<T>();
    };
    return statement;
  };
  return {
    prepare: (query: string) => {
      counts.queries.push(query);
      return counted(source.prepare(query));
    },
    batch: (statements) => {
      counts.batches += 1;
      counts.statements += statements.length;
      return source.batch(statements);
    },
    exec: (query) => source.exec(query),
    withSession: (constraintOrBookmark) => source.withSession(constraintOrBookmark),
    dump: () => source.dump(),
  };
}

function resetCounts(counts: D1Counts) {
  counts.statements = 0;
  counts.batches = 0;
  counts.queries = [];
}

function authUser(id: string, email: string): AuthUser {
  return { id, email, name: id, avatarUrl: null, analyticsEnabled: null, chatColor: null };
}

function seed(database: DatabaseSync) {
  const addUser = database.prepare(
    "INSERT INTO users(id, identity_key, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  addUser.run("user-owner", "email:owner", "owner@example.test", "Owner", NOW, NOW);
  addUser.run("user-recipient", "email:recipient", RECIPIENT_EMAIL, "Recipient", NOW, NOW);
  addUser.run("user-other", "email:other", "other@example.test", "Other", NOW, NOW);
  const addHost = database.prepare(
    "INSERT INTO remote_hosts(host_id, owner_user_id, name, device_public_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const hostId of ["host-joined", "host-offered", "host-expired", "host-elsewhere"]) {
    addHost.run(hostId, "user-owner", hostId, `key-${hostId}`, NOW, NOW);
  }
  const addMembership = database.prepare(
    "INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
  );
  for (const hostId of ["host-joined", "host-offered", "host-expired", "host-elsewhere"]) {
    addMembership.run(`${hostId}-owner`, hostId, "user-owner", "owner", NOW, NOW);
  }
  addMembership.run("host-joined-recipient", "host-joined", "user-recipient", "member", NOW, NOW);
  const addTransfer = database.prepare(
    `INSERT INTO remote_owner_transfers(transfer_id, host_id, from_user_id, to_email, status, created_at, expires_at, updated_at)
     VALUES (?, ?, 'user-owner', ?, ?, ?, ?, ?)`,
  );
  addTransfer.run("transfer-pending", "host-offered", RECIPIENT_EMAIL, "pending", NOW - 1_000, NOW + DAY_MS, NOW);
  addTransfer.run("transfer-expired", "host-expired", RECIPIENT_EMAIL, "pending", NOW - DAY_MS, NOW - 1, NOW);
  addTransfer.run("transfer-declined", "host-joined", RECIPIENT_EMAIL, "declined", NOW - 2_000, NOW + DAY_MS, NOW);
  addTransfer.run(
    "transfer-elsewhere",
    "host-elsewhere",
    "other@example.test",
    "pending",
    NOW - 3_000,
    NOW + DAY_MS,
    NOW,
  );
}

async function main() {
  const database = await migratedDatabase();
  seed(database);
  const ticketKeys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", ticketKeys.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", ticketKeys.privateKey);
  const counts: D1Counts = { statements: 0, batches: 0, queries: [] };
  const plane = new RemoteControlPlane(
    {
      DB: observedD1(countedD1(database, counts)),
      REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "ticket-1" }),
      REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [{ ...publicJwk, kid: "ticket-1" }] }),
      REMOTE_TICKET_KEY_ID: "ticket-1",
    },
    { now: () => NOW, schedule: () => undefined },
  );
  const recipient = authUser("user-recipient", " Recipient@Example.test ");

  const listed = await Effect.runPromise(plane.listHostsWithTransfers(recipient));
  const listedBody = JSON.parse(JSON.stringify(listed));
  const listedCounts = { statements: counts.statements, batches: counts.batches };
  const transferQuery = counts.queries.find((query) => query.includes("t.to_email = ?"));
  check("the host list has the joined server", listed.hosts.map((host) => host.hostId).join(",") === "host-joined", {
    hosts: listed.hosts.map((host) => host.hostId),
  });
  const listedTransfers = decodeListedOwnerTransfers(listedBody);
  check(
    "the host list carries only the live pending transfer to this email",
    listedTransfers?.map((transfer) => transfer.transferId).join(",") === "transfer-pending",
    { transfers: listedTransfers?.map((transfer) => transfer.transferId) ?? null },
  );
  check(
    "the listed transfer has the sender and the server name",
    listedTransfers?.[0]?.fromEmail === "owner@example.test" && listedTransfers[0].hostName === "host-offered",
    listedTransfers?.[0],
  );
  check(
    "the host list and the transfers take one D1 batch of two statements",
    listedCounts.batches === 1 && listedCounts.statements === 2,
    listedCounts,
  );
  const plan = transferQuery
    ? database
        .prepare(`EXPLAIN QUERY PLAN ${transferQuery}`)
        .all(RECIPIENT_EMAIL, NOW)
        .map((row) => String(row.detail))
    : [];
  check(
    "the transfer read uses the pending email index from migration 0060",
    plan.some((detail) => detail.includes("remote_owner_transfers_pending_email")),
    { plan },
  );

  resetCounts(counts);
  const incoming = await Effect.runPromise(plane.incomingOwnerTransfers(recipient));
  const oldRouteBody = JSON.parse(JSON.stringify({ transfers: incoming }));
  check(
    "the old owner-transfers route still returns the same transfer",
    decodeIncomingOwnerTransfers(oldRouteBody)
      .map((transfer) => transfer.transferId)
      .join(",") === "transfer-pending",
    { transfers: incoming.map((transfer) => transfer.transferId), statements: counts.statements },
  );

  resetCounts(counts);
  const hostsOnly = await Effect.runPromise(plane.listHosts("user-recipient"));
  check(
    "the host list without transfers still takes one D1 statement",
    hostsOnly.length === 1 && counts.statements === 1 && counts.batches === 0,
    { statements: counts.statements, batches: counts.batches },
  );

  const oldDecoderHosts = Array.isArray(listedBody.hosts) ? listedBody.hosts.length : null;
  check(
    "an old decoder that reads only hosts gets the same servers",
    oldDecoderHosts === listed.hosts.length && decodeListedOwnerTransfers({ hosts: listedBody.hosts }) === null,
    { hosts: oldDecoderHosts },
  );

  resetCounts(counts);
  const stranger = await Effect.runPromise(plane.listHostsWithTransfers(authUser("user-none", "none@example.test")));
  check(
    "an account with no servers and no transfers gets empty lists in one batch",
    stranger.hosts.length === 0 && stranger.pendingIncomingTransfers.length === 0 && counts.batches === 1,
    { batches: counts.batches, statements: counts.statements },
  );

  const passed = checks.every((entry) => entry.passed);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "host-list.json"), `${JSON.stringify(listedBody, null, 2)}\n`);
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
  for (const entry of checks) console.log(`${entry.passed ? "ok" : "FAIL"} ${entry.name}`);
  if (!passed) process.exit(1);
}

await main();
