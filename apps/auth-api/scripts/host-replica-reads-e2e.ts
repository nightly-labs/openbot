import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { Effect, Exit } from "effect";
import { BillingService } from "../src/server/billing-service";
import { HostedServerService } from "../src/server/hosted-server-service";
import { RemoteControlPlane, type RemoteResumeClaims } from "../src/server/remote-control-plane";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const OUT_ARGUMENT = process.argv.find((argument) => argument.startsWith("--out="));
const REPORT = OUT_ARGUMENT
  ? resolve(OUT_ARGUMENT.slice("--out=".length))
  : join(ROOT, ".openbot-build", "host-replica-reads-e2e", "report.json");
const REQUESTS = 100;
const REPLICA_LAG_MS = 20_000;
const REVOCATION_WINDOW_MS = 60_000;
const START = Date.UTC(2026, 10, 28, 12);
const SESSION_EXPIRES_AT = START + 30 * 86_400_000;
const POOL_TOKEN_100 = "pool-token-100-".padEnd(48, "a");
const POOL_TOKEN_200 = "pool-token-200-".padEnd(48, "b");
const POOL_TOKEN_WRONG = "pool-token-200-".padEnd(48, "c");

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

const ticketKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const privateJwk = JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", ticketKeyPair.privateKey)), kid: "t1" });
const ticketKeys = {
  REMOTE_TICKET_PRIVATE_JWK: privateJwk,
  REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({
    keys: [{ ...(await crypto.subtle.exportKey("jwk", ticketKeyPair.publicKey)), kid: "t1" }],
  }),
  REMOTE_TICKET_KEY_ID: "t1",
};

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of (await readdir(MIGRATIONS)).sort()) database.exec(await readFile(join(MIGRATIONS, name), "utf8"));
  return database;
}

type Target = "primary" | "replica";
const counts = new Map<string, Record<Target, number>>();
let requestType = "setup";

function countingD1(database: DatabaseSync, target: Target) {
  const source = sqliteD1(database);
  return {
    prepare: (query: string) => {
      const entry = counts.get(requestType) ?? { primary: 0, replica: 0 };
      entry[target] += 1;
      counts.set(requestType, entry);
      return source.prepare(query);
    },
    batch: source.batch.bind(source),
    exec: source.exec.bind(source),
    dump: source.dump.bind(source),
  };
}

function staleReplicaD1(primary: DatabaseSync, replica: DatabaseSync): D1Database {
  const primaryD1 = countingD1(primary, "primary");
  const replicaD1 = countingD1(replica, "replica");
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

const primary = await migratedDatabase();
const replica = await migratedDatabase();
const pending: { sql: string; values: SQLInputValue[] }[] = [];
const clock = { now: START };

function both(sql: string, ...values: SQLInputValue[]) {
  primary.prepare(sql).run(...values);
  replica.prepare(sql).run(...values);
}

function primaryOnly(sql: string, ...values: SQLInputValue[]) {
  primary.prepare(sql).run(...values);
  pending.push({ sql, values });
}

function catchUp() {
  for (const entry of pending.splice(0)) replica.prepare(entry.sql).run(...entry.values);
}

const write = { both, primaryOnly };
type Write = keyof typeof write;

function user(id: string, place: Write = "both") {
  write[place](
    "INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)",
    id,
    `email:${id}`,
    `${id}@example.test`,
  );
}

function host(hostId: string, token: string, place: Write = "both") {
  write[place](
    `INSERT INTO remote_hosts(host_id, owner_user_id, name, auth_epoch, machine_token_hash, created_at, updated_at)
     VALUES (?, 'owner', ?, 1, ?, 1, 1)`,
    hostId,
    `Host ${hostId}`,
    tokenHash(token),
  );
  write[place](
    `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
     VALUES (?, ?, 'owner', 'owner', 'active', 1, 1)`,
    `${hostId}:owner`,
    hostId,
  );
}

function member(hostId: string, userId: string, role: string, place: Write = "both") {
  write[place](
    `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', 1, 1)
     ON CONFLICT(membership_id) DO UPDATE SET role = excluded.role, status = 'active'`,
    `${hostId}:${userId}`,
    hostId,
    userId,
    role,
  );
}

function session(sessionId: string, hostId: string, userId: string, place: Write = "both") {
  write[place](
    `INSERT INTO remote_sessions(session_id, host_id, user_id, membership_id, started_at, ended_at, expires_at, auth_session_hash)
     VALUES (?, ?, ?, ?, 1, NULL, ?, NULL)`,
    sessionId,
    hostId,
    userId,
    `${hostId}:${userId}`,
    SESSION_EXPIRES_AT,
  );
}

function memberClaims(sessionId: string, hostId: string, userId: string): RemoteResumeClaims {
  return {
    sessionId,
    hostId,
    userId,
    membershipId: `${hostId}:${userId}`,
    role: "member",
    authEpoch: 1,
    sessionExpiresAt: Math.floor(SESSION_EXPIRES_AT / 1_000),
  };
}

function hostClaims(hostId: string): RemoteResumeClaims {
  return {
    sessionId: `host-${hostId}`,
    hostId,
    userId: "owner",
    membershipId: `${hostId}:host`,
    role: "host",
    authEpoch: 1,
    sessionExpiresAt: Math.floor(SESSION_EXPIRES_AT / 1_000),
  };
}

const database = staleReplicaD1(primary, replica);
const plane = new RemoteControlPlane({ DB: database, ...ticketKeys }, { now: () => clock.now });
const billing = new BillingService({
  database,
  secretKey: "sk_test_none",
  webhookSecret: null,
  fetch: async () => Response.json({ object: "list", data: [], has_more: false }),
  now: () => clock.now,
});
const hosted = new HostedServerService(
  {
    DB: database,
    HOSTED_SERVERS_ENABLED: "true",
    BOAT_API_KEY: "boat-key",
    BOAT_WEBHOOK_SECRET: "webhook-secret",
    HOSTED_SERVER_TEMPLATE: "tpl_1",
    REMOTE_TICKET_PRIVATE_JWK: privateJwk,
  },
  {
    fetch: async () => Response.json({}, { status: 404 }),
    now: () => clock.now,
    removeHost: () => Effect.void,
    schedule: () => undefined,
  },
);

function operatorHost(hostId: string, token: string, place: Write = "both") {
  write[place](
    `INSERT INTO operator_hosts(host_id, location, product, added_at, removed_at, assign_token_hash, seen_at)
     VALUES (?, 'AMS-01', 'VPS12', 1, NULL, ?, ?)
     ON CONFLICT(host_id) DO UPDATE SET assign_token_hash = excluded.assign_token_hash`,
    hostId,
    tokenHash(token),
    clock.now,
  );
}

function copySeenAtToReplica(hostId: string) {
  const seen = primary.prepare("SELECT seen_at FROM operator_hosts WHERE host_id = ?").get(hostId);
  replica.prepare("UPDATE operator_hosts SET seen_at = ? WHERE host_id = ?").run(Number(seen?.seen_at), hostId);
}

async function accepted<A, E>(effect: Effect.Effect<A, E>): Promise<boolean> {
  return Exit.isSuccess(await Effect.runPromiseExit(effect));
}

async function value<A, E>(effect: Effect.Effect<A, E>): Promise<A | null> {
  const exit = await Effect.runPromiseExit(effect);
  return Exit.isSuccess(exit) ? exit.value : null;
}

user("owner");
user("member");
user("admin");
host("host-measure", "token-measure");
member("host-measure", "member", "member");
member("host-measure", "admin", "admin");
session("session-measure", "host-measure", "member");
operatorHost("leaseweb:100", POOL_TOKEN_100);

async function measure(type: string, request: (index: number) => Promise<boolean>) {
  requestType = type;
  counts.set(type, { primary: 0, replica: 0 });
  let answered = 0;
  for (let index = 0; index < REQUESTS; index += 1) {
    clock.now += 1_000;
    if (await request(index)) answered += 1;
  }
  requestType = "setup";
  return answered;
}

const measured: Record<string, number> = {
  "host credential (notification, route tickets)": await measure("host credential (notification, route tickets)", () =>
    accepted(plane.assertHostCredential("host-measure", "token-measure")),
  ),
  "notification session check": await measure("notification session check", async () =>
    Boolean(await value(plane.sessionOpen("host-measure", "session-measure"))),
  ),
  "resume validate": await measure("resume validate", (index) =>
    value(
      plane.validateResumeClaims(
        index % 2 === 0 ? hostClaims("host-measure") : memberClaims("session-measure", "host-measure", "member"),
      ),
    ).then(Boolean),
  ),
  "resume validate-batch (10 claims)": await measure("resume validate-batch (10 claims)", async () => {
    const answers = await value(
      plane.validateResumeClaimsBatch(
        Array.from({ length: 10 }, (_, index) =>
          index % 2 === 0 ? hostClaims("host-measure") : memberClaims("session-measure", "host-measure", "member"),
        ),
      ),
    );
    return answers?.every(Boolean) ?? false;
  }),
  "host list": await measure("host list", async () => ((await value(plane.listHosts("member")))?.length ?? 0) === 1),
  "member list": await measure("member list", async () =>
    Boolean(await value(plane.listMembers("member", "host-measure"))),
  ),
  "credits state": await measure("credits state", async () =>
    Boolean(await value(billing.credits.getState("member", "replica"))),
  ),
  "pool assignment poll": await measure("pool assignment poll", () => {
    copySeenAtToReplica("leaseweb:100");
    return accepted(hosted.poolAssignment("leaseweb:100", POOL_TOKEN_100));
  }),
  "host ticket and money checks (authenticateHost)": await measure(
    "host ticket and money checks (authenticateHost)",
    () => accepted(plane.authenticateHost("host-measure", "token-measure")),
  ),
};
const queriesPer100 = Object.fromEntries(
  Object.keys(measured).map((type) => [type, counts.get(type) ?? { primary: 0, replica: 0 }]),
);
check(
  `each measured request type answers all ${REQUESTS} requests`,
  Object.values(measured).every((answered) => answered === REQUESTS),
  measured,
);

async function scenario() {
  host("host-rotated", "token-before");
  clock.now += 1_000;
  const before = await accepted(plane.assertHostCredential("host-rotated", "token-before"));
  primaryOnly(
    "UPDATE remote_hosts SET machine_token_hash = ? WHERE host_id = 'host-rotated'",
    tokenHash("token-after"),
  );
  const rotatedAt = clock.now;
  const after = await accepted(plane.assertHostCredential("host-rotated", "token-after"));
  check("a rotated host key works at once while the replica is stale", before && after, { before, after });
  let refusedAfter: number | null = null;
  while (clock.now - rotatedAt <= REVOCATION_WINDOW_MS + 30_000) {
    clock.now += 1_000;
    if (clock.now - rotatedAt >= REPLICA_LAG_MS) catchUp();
    if (!(await accepted(plane.assertHostCredential("host-rotated", "token-before")))) {
      refusedAfter = clock.now - rotatedAt;
      break;
    }
  }
  check(
    `the old host key is refused within ${REVOCATION_WINDOW_MS / 1_000} s when the replica is ${REPLICA_LAG_MS / 1_000} s late`,
    refusedAfter !== null && refusedAfter <= REVOCATION_WINDOW_MS,
    { refusedAfterMs: refusedAfter, replicaLagMs: REPLICA_LAG_MS },
  );
  check(
    "the new host key still works after the replica catches up",
    await accepted(plane.assertHostCredential("host-rotated", "token-after")),
  );

  host("host-new", "token-new", "primaryOnly");
  check(
    "a new host that only the primary has is accepted at once",
    await accepted(plane.assertHostCredential("host-new", "token-new")),
  );
  check(
    "the host claims of a new host are accepted at once",
    (await value(plane.validateResumeClaims(hostClaims("host-new")))) === true,
  );
  user("joiner");
  member("host-new", "joiner", "member", "primaryOnly");
  check(
    "the host list of an account whose first server only the primary has reads the primary",
    ((await value(plane.listHosts("joiner"))) ?? []).some((entry) => entry.hostId === "host-new"),
  );

  user("member-new");
  member("host-measure", "member-new", "member");
  session("session-new", "host-measure", "member-new", "primaryOnly");
  check(
    "a new session that only the primary has passes the notification check at once",
    (await value(plane.sessionOpen("host-measure", "session-new"))) === true,
  );
  check(
    "a new session that only the primary has passes resume validate at once",
    (await value(plane.validateResumeClaims(memberClaims("session-new", "host-measure", "member-new")))) === true,
  );
  const batch = await value(
    plane.validateResumeClaimsBatch([
      memberClaims("session-new", "host-measure", "member-new"),
      memberClaims("session-measure", "host-measure", "member"),
      hostClaims("host-missing"),
    ]),
  );
  check("validate-batch accepts a new session and refuses an unknown host", batch?.join() === "true,true,false", {
    batch,
  });
  catchUp();

  user("member-reopened");
  member("host-measure", "member-reopened", "member");
  session("session-reopened", "host-measure", "member-reopened");
  replica.prepare("UPDATE remote_sessions SET ended_at = 1 WHERE session_id = 'session-reopened'").run();
  check(
    "a session that the replica shows as ended is accepted when the primary shows it open",
    (await value(plane.sessionOpen("host-measure", "session-reopened"))) === true &&
      (await value(plane.validateResumeClaims(memberClaims("session-reopened", "host-measure", "member-reopened")))) ===
        true,
  );
  primary.prepare("UPDATE remote_sessions SET ended_at = 1 WHERE session_id = 'session-reopened'").run();
  check(
    "a session that the replica and the primary show as ended is refused",
    (await value(plane.sessionOpen("host-measure", "session-reopened"))) === false &&
      (await value(plane.validateResumeClaims(memberClaims("session-reopened", "host-measure", "member-reopened")))) ===
        false,
  );

  member("host-measure", "member", "admin", "primaryOnly");
  check(
    "a member who became admin on the primary sees invitations at once",
    await accepted(plane.listInvites("member", "host-measure")),
  );
  catchUp();
  user("stranger");
  const strangerMembers = await Effect.runPromiseExit(plane.listMembers("stranger", "host-measure"));
  check(
    "an account with no membership is refused with remote_permission_denied",
    Exit.isFailure(strangerMembers) && JSON.stringify(strangerMembers.cause).includes("remote_permission_denied"),
  );

  operatorHost("leaseweb:200", POOL_TOKEN_200, "primaryOnly");
  check(
    "a new pool machine that only the primary has gets its assignment at once",
    await accepted(hosted.poolAssignment("leaseweb:200", POOL_TOKEN_200)),
  );
  check(
    "a pool machine with a wrong token is refused",
    !(await accepted(hosted.poolAssignment("leaseweb:200", POOL_TOKEN_WRONG))),
  );
  catchUp();
}

try {
  await scenario();
} catch (error) {
  check("scenario", false, { error: error instanceof Error ? error.message : String(error) });
}

await mkdir(dirname(REPORT), { recursive: true });
const report = {
  passed: checks.length > 0 && checks.every((entry) => entry.passed),
  requestsPerType: REQUESTS,
  secondsBetweenRequests: 1,
  queriesPer100,
  checks,
};
await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);
for (const [type, entry] of Object.entries(queriesPer100))
  console.log(`${type}: primary ${entry.primary}, replica ${entry.replica}`);
for (const entry of checks) console.log(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}`);
console.log(`Report: ${REPORT}`);
if (!report.passed) process.exitCode = 1;
