import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LEGACY_MEMBER_LIMITS } from "@openbot/contracts/billing";
import { HOST_KEY_HANDOVER_LIMIT } from "@openbot/contracts/host-key-handover";
import { DEFAULT_TEAM_MEMBER_LIMIT } from "@openbot/contracts/input-limits";
import { Effect } from "effect";
import { observedD1 } from "../src/server/observed-d1";
import { RemoteControlPlane } from "../src/server/remote-control-plane";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "host-list-batch-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const NOW = Date.parse("2026-11-27T13:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const VIEWER = "user-viewer";

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

interface CallCounts {
  calls: number;
}

function countedD1(database: DatabaseSync, counts: CallCounts): D1Database {
  const source = sqliteD1(database);
  const counted = (statement: D1PreparedStatement): D1PreparedStatement => {
    const { bind, first, all, run } = statement;
    statement.bind = (...values: unknown[]) => counted(bind(...values));
    statement.first = <T>(column?: string) => {
      counts.calls += 1;
      return column === undefined ? first<T>() : first<T>(column);
    };
    statement.all = <T>() => {
      counts.calls += 1;
      return all<T>();
    };
    statement.run = <T>() => {
      counts.calls += 1;
      return run<T>();
    };
    return statement;
  };
  return {
    prepare: (query: string) => counted(source.prepare(query)),
    batch: (statements) => {
      counts.calls += statements.length;
      return source.batch(statements);
    },
    exec: (query) => source.exec(query),
    withSession: (constraintOrBookmark) => source.withSession(constraintOrBookmark),
    dump: () => source.dump(),
  };
}

function addHost(database: DatabaseSync, hostId: string, ownerId: string, viewerRole: "owner" | "member") {
  database
    .prepare("INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(hostId, ownerId, hostId, NOW, NOW);
  const addMembership = database.prepare(
    "INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
  );
  if (viewerRole === "owner") {
    addMembership.run(`${hostId}-viewer`, hostId, VIEWER, "owner", NOW, NOW);
    return;
  }
  addMembership.run(`${hostId}-owner`, hostId, ownerId, "owner", NOW, NOW);
  addMembership.run(`${hostId}-viewer`, hostId, VIEWER, "member", NOW, NOW);
}

async function main() {
  const database = await migratedDatabase();
  const addUser = database.prepare(
    "INSERT INTO users(id, identity_key, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const id of [VIEWER, "owner-custom", "owner-plan", "owner-default"]) {
    addUser.run(id, `email:${id}`, `${id}@example.test`, id, NOW, NOW);
  }
  addHost(database, "host-licensed", VIEWER, "owner");
  addHost(database, "host-custom", "owner-custom", "member");
  addHost(database, "host-plan", "owner-plan", "member");
  addHost(database, "host-default", "owner-default", "member");
  database
    .prepare(
      `INSERT INTO licenses(stripe_subscription_id, user_id, stripe_customer_id, users, currency, status,
         current_period_end, cancel_at_period_end, updated_at)
       VALUES ('sub_license', ?, 'cus_license', 7, 'eur', 'active', ?, 0, ?)`,
    )
    .run(VIEWER, NOW + DAY_MS, NOW);
  database
    .prepare(
      `INSERT INTO server_member_limits(server_id, owner_user_id, member_limit, created_at, updated_at)
       VALUES ('host-custom', 'owner-custom', 4, ?, ?)`,
    )
    .run(NOW, NOW);
  database
    .prepare(
      `INSERT INTO billing_subscriptions(stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval,
         currency, amount, status, current_period_end, cancel_at_period_end, updated_at)
       VALUES ('sub_plan', 'owner-plan', 'cus_plan', 'host-plan', 'pro', 'month', 'eur', 900, 'active', ?, 0, ?)`,
    )
    .run(NOW + DAY_MS, NOW);
  database
    .prepare(
      `INSERT INTO remote_host_key_handovers(handover_id, host_id, issued_at, previous_public_key, public_key,
         previous_signature, signature, created_at)
       VALUES ('handover-1', 'host-plan', ?, 'old-key', 'new-key', 'old-signature', 'new-signature', ?)`,
    )
    .run(NOW, NOW);
  database
    .prepare(
      `INSERT INTO licenses(stripe_subscription_id, user_id, stripe_customer_id, users, currency, status,
         current_period_end, cancel_at_period_end, updated_at)
       VALUES ('sub_license_lapsed', ?, 'cus_license', 20, 'eur', 'past_due', ?, 0, ?)`,
    )
    .run(VIEWER, NOW - DAY_MS, NOW + 1);
  database
    .prepare(
      `INSERT INTO billing_subscriptions(stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval,
         currency, amount, status, current_period_end, cancel_at_period_end, updated_at)
       VALUES ('sub_plan_lapsed', 'owner-plan', 'cus_plan', 'host-plan', 'starter', 'month', 'eur', 300, 'past_due', ?, 0, ?)`,
    )
    .run(NOW - DAY_MS, NOW + 1);
  const addHandover = database.prepare(
    `INSERT INTO remote_host_key_handovers(handover_id, host_id, issued_at, previous_public_key, public_key,
       previous_signature, signature, created_at)
     VALUES (?, 'host-licensed', ?, ?, ?, ?, ?, ?)`,
  );
  for (let index = 0; index < HOST_KEY_HANDOVER_LIMIT + 2; index += 1) {
    addHandover.run(
      `licensed-handover-${index}`,
      NOW - index * 1_000,
      `key-${index + 1}`,
      `key-${index}`,
      `signature-${index + 1}`,
      `signature-${index}`,
      NOW,
    );
  }

  const ticketKeys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", ticketKeys.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", ticketKeys.privateKey);
  const counts: CallCounts = { calls: 0 };
  const plane = new RemoteControlPlane(
    {
      DB: observedD1(countedD1(database, counts)),
      REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "ticket-1" }),
      REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [{ ...publicJwk, kid: "ticket-1" }] }),
      REMOTE_TICKET_KEY_ID: "ticket-1",
    },
    { now: () => NOW, schedule: () => undefined },
  );

  const hosts = await Effect.runPromise(plane.listHosts(VIEWER));
  const byId = new Map(hosts.map((host) => [host.hostId, host]));
  const limits = Object.fromEntries(hosts.map((host) => [host.hostId, host.memberLimit]));
  check("the host list has the four servers", hosts.length === 4, { hosts: hosts.map((host) => host.hostId) });
  check("a custom member limit row sets the limit", byId.get("host-custom")?.memberLimit === 4, limits);
  check(
    "an owner license sets the limit and raises it for the owner",
    byId.get("host-licensed")?.memberLimit === 7 && byId.get("host-licensed")?.licenseRaisesMemberLimit === true,
    limits,
  );
  check("a server plan sets the limit", byId.get("host-plan")?.memberLimit === LEGACY_MEMBER_LIMITS.pro, limits);
  check(
    "a server with no plan, license or custom row gets the default limit",
    byId.get("host-default")?.memberLimit === DEFAULT_TEAM_MEMBER_LIMIT,
    limits,
  );
  check(
    "a member does not see a license raise",
    [byId.get("host-custom"), byId.get("host-plan"), byId.get("host-default")].every(
      (host) => host?.licenseRaisesMemberLimit === false,
    ),
  );
  check(
    "each server gets only its own key handovers",
    byId.get("host-plan")?.keyHandovers.length === 1 &&
      byId.get("host-plan")?.keyHandovers[0]?.publicKey === "new-key" &&
      byId.get("host-default")?.keyHandovers.length === 0,
  );
  const licensedHandovers = byId.get("host-licensed")?.keyHandovers ?? [];
  check(
    "a server gets only its newest key handovers, oldest first",
    licensedHandovers.length === HOST_KEY_HANDOVER_LIMIT &&
      licensedHandovers[0]?.publicKey === `key-${HOST_KEY_HANDOVER_LIMIT - 1}` &&
      licensedHandovers.at(-1)?.publicKey === "key-0",
    { first: licensedHandovers[0]?.publicKey, last: licensedHandovers.at(-1)?.publicKey },
  );
  check("four servers take one D1 statement", counts.calls === 1, { calls: counts.calls });

  counts.calls = 0;
  const single = await Effect.runPromise(plane.listHosts("owner-default"));
  check("one server also takes one D1 statement", single.length === 1 && counts.calls === 1, { calls: counts.calls });

  counts.calls = 0;
  const none = await Effect.runPromise(plane.listHosts("user-unknown"));
  check("an account with no servers takes one D1 statement", none.length === 0 && counts.calls === 1, {
    calls: counts.calls,
  });

  const passed = checks.every((entry) => entry.passed);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "hosts.json"), `${JSON.stringify(hosts, null, 2)}\n`);
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
  for (const entry of checks) console.log(`${entry.passed ? "ok" : "FAIL"} ${entry.name}`);
  if (!passed) process.exit(1);
}

await main();
