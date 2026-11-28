import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import {
  REMOTE_RESUME_BATCH_LIMIT,
  RemoteControlPlane,
  type RemoteResumeClaims,
} from "../src/server/remote-control-plane";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "remote-resume-batch-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const NOW = Date.now();
const SESSION_EXPIRES_AT = NOW + 86_400_000;

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

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of (await readdir(MIGRATIONS)).sort()) database.exec(await readFile(join(MIGRATIONS, name), "utf8"));
  const user = database.prepare(
    "INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)",
  );
  user.run("owner", "email:owner", "owner@example.test");
  const host = database.prepare(
    `INSERT INTO remote_hosts(host_id, owner_user_id, name, auth_epoch, created_at, updated_at)
     VALUES (?, 'owner', 'Host', ?, 1, 1)`,
  );
  host.run("host-a", 1);
  host.run("host-b", 3);
  const membership = database.prepare(
    `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
     VALUES (?, 'host-a', ?, ?, ?, 1, 1)`,
  );
  const authSession = database.prepare(
    "INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, 1, 1, ?)",
  );
  const session = database.prepare(
    `INSERT INTO remote_sessions(session_id, host_id, user_id, membership_id, started_at, ended_at, expires_at, auth_session_hash)
     VALUES (?, 'host-a', ?, ?, 1, ?, ?, ?)`,
  );
  const memberSession = (
    sessionId: string,
    options: { role?: string; status?: string; endedAt?: number; expiresAt?: number; signInRevokedAt?: number | null },
  ) => {
    const userId = `user-${sessionId}`;
    user.run(userId, `email:${userId}`, `${userId}@example.test`);
    membership.run(`membership-${sessionId}`, userId, options.role ?? "member", options.status ?? "active");
    const signIn = options.signInRevokedAt === undefined ? null : tokenHash(`sign-in-${sessionId}`);
    if (signIn)
      authSession.run(`auth-${sessionId}`, userId, signIn, SESSION_EXPIRES_AT, options.signInRevokedAt ?? null);
    session.run(
      sessionId,
      userId,
      `membership-${sessionId}`,
      options.endedAt ?? null,
      options.expiresAt ?? SESSION_EXPIRES_AT,
      signIn,
    );
  };
  memberSession("session-live", {});
  memberSession("session-sign-in-live", { signInRevokedAt: null });
  memberSession("session-sign-in-revoked", { signInRevokedAt: NOW - 1_000 });
  memberSession("session-ended", { endedAt: NOW - 1_000 });
  memberSession("session-expired", { expiresAt: NOW - 1_000 });
  memberSession("session-revoked-membership", { role: "admin", status: "revoked" });
  return database;
}

const sessionExpiresAt = Math.floor(SESSION_EXPIRES_AT / 1_000);
const hostClaims = (hostId: string, authEpoch: number): RemoteResumeClaims => ({
  sessionId: `host-${hostId}`,
  hostId,
  userId: "owner",
  membershipId: `${hostId}:host`,
  role: "host",
  authEpoch,
  sessionExpiresAt,
});
const memberClaims = (sessionId: string, overrides: Partial<RemoteResumeClaims> = {}): RemoteResumeClaims => ({
  sessionId,
  hostId: "host-a",
  userId: `user-${sessionId}`,
  membershipId: `membership-${sessionId}`,
  role: "member",
  authEpoch: 1,
  sessionExpiresAt,
  ...overrides,
});

const cases: { name: string; claims: RemoteResumeClaims; valid: boolean }[] = [
  { name: "host with the current epoch", claims: hostClaims("host-a", 1), valid: true },
  { name: "second host with the current epoch", claims: hostClaims("host-b", 3), valid: true },
  { name: "host with an old epoch", claims: hostClaims("host-b", 2), valid: false },
  { name: "unknown host", claims: hostClaims("host-missing", 1), valid: false },
  {
    name: "host claims of another owner",
    claims: { ...hostClaims("host-a", 1), userId: "user-session-live" },
    valid: false,
  },
  { name: "active member session", claims: memberClaims("session-live"), valid: true },
  { name: "member session with a live sign-in", claims: memberClaims("session-sign-in-live"), valid: true },
  { name: "member session with a revoked sign-in", claims: memberClaims("session-sign-in-revoked"), valid: false },
  { name: "ended member session", claims: memberClaims("session-ended"), valid: false },
  { name: "expired member session", claims: memberClaims("session-expired"), valid: false },
  {
    name: "revoked membership",
    claims: memberClaims("session-revoked-membership", { role: "admin" }),
    valid: false,
  },
  { name: "member session with another role", claims: memberClaims("session-live", { role: "admin" }), valid: false },
  { name: "member session with an old epoch", claims: memberClaims("session-live", { authEpoch: 0 }), valid: false },
  {
    name: "member session with another expiry",
    claims: memberClaims("session-live", { sessionExpiresAt: sessionExpiresAt + 1 }),
    valid: false,
  },
  { name: "unknown member session", claims: memberClaims("session-missing"), valid: false },
  {
    name: "claims that expired",
    claims: memberClaims("session-live", { sessionExpiresAt: Math.floor(NOW / 1_000) - 1 }),
    valid: false,
  },
  { name: "duplicate of the active member session", claims: memberClaims("session-live"), valid: true },
];

function countingD1(database: DatabaseSync, queries: string[], replicaQueries: string[]): D1Database {
  const source = sqliteD1(database);
  return {
    prepare: (query: string) => {
      queries.push(query);
      return source.prepare(query);
    },
    batch: (statements) => source.batch(statements),
    exec: (query) => source.exec(query),
    withSession: () => ({
      prepare: (query: string) => {
        replicaQueries.push(query);
        return source.prepare(query);
      },
      batch: (statements) => source.batch(statements),
      getBookmark: () => null,
    }),
    dump: () => source.dump(),
  };
}

function queryPlan(database: DatabaseSync, query: string, values: (string | number)[]): string[] {
  return database
    .prepare(`EXPLAIN QUERY PLAN ${query}`)
    .all(...values)
    .map((row) => String(row.detail));
}

async function scenario() {
  const database = await migratedDatabase();
  const queries: string[] = [];
  const replicaQueries: string[] = [];
  const plane = new RemoteControlPlane({ DB: countingD1(database, queries, replicaQueries), ...ticketKeys });
  const resetQueries = () => {
    queries.length = 0;
    replicaQueries.length = 0;
  };

  const single: boolean[] = [];
  for (const entry of cases) single.push(await Effect.runPromise(plane.validateResumeClaims(entry.claims)));
  const expected = cases.map((entry) => entry.valid);
  check(
    "the single route gives the expected answer for each case",
    single.every((valid, index) => valid === expected[index]),
    cases.map((entry, index) => ({ case: entry.name, expected: entry.valid, single: single[index] })),
  );

  resetQueries();
  const batch = await Effect.runPromise(plane.validateResumeClaimsBatch(cases.map((entry) => entry.claims)));
  const batchQueries = [...replicaQueries];
  const batchPrimaryQueries = [...queries];
  check(
    "the batch gives the same answer as the single route for each case, in input order",
    batch.length === cases.length && batch.every((valid, index) => valid === single[index]),
    cases.map((entry, index) => ({ case: entry.name, single: single[index], batch: batch[index] })),
  );
  check(
    "the batch reads the replica with one host query and one session query, and the primary only for claims that the replica does not confirm",
    batchQueries.length === 2 && batchPrimaryQueries.length === 2,
    { replicaQueries: batchQueries.length, primaryQueries: batchPrimaryQueries.length },
  );

  const [hostQuery, sessionQuery] = batchQueries;
  const hostPlan = hostQuery ? queryPlan(database, hostQuery, [JSON.stringify(["host-a", "host-b"])]) : [];
  const sessionPlan = sessionQuery
    ? queryPlan(database, sessionQuery, [JSON.stringify(["session-live", "session-ended"]), NOW])
    : [];
  check(
    "the batch queries look up hosts and sessions by primary key, with no table scan",
    hostPlan.some((line) => /SEARCH remote_hosts USING/u.test(line)) &&
      sessionPlan.some((line) => /SEARCH s USING/u.test(line)) &&
      ![...hostPlan, ...sessionPlan].some((line) => /^SCAN (remote_hosts|remote_sessions|s|m|h)\b/u.test(line)),
    { hostPlan, sessionPlan },
  );

  resetQueries();
  const hostsOnly = await Effect.runPromise(
    plane.validateResumeClaimsBatch([hostClaims("host-a", 1), hostClaims("host-b", 2)]),
  );
  check(
    "a batch of host claims makes one replica query and one primary query for the refused claim",
    hostsOnly.join() === "true,false" && replicaQueries.length === 1 && queries.length === 1,
    { answers: hostsOnly, replicaQueries: replicaQueries.length, primaryQueries: queries.length },
  );

  resetQueries();
  const confirmed = await Effect.runPromise(
    plane.validateResumeClaimsBatch([hostClaims("host-a", 1), memberClaims("session-live")]),
  );
  check(
    "a batch that the replica confirms makes no primary query",
    confirmed.join() === "true,true" && replicaQueries.length === 2 && queries.length === 0,
    { answers: confirmed, replicaQueries: replicaQueries.length, primaryQueries: queries.length },
  );

  const full = Array.from({ length: REMOTE_RESUME_BATCH_LIMIT }, (_, index) =>
    index % 2 === 0 ? hostClaims(index % 4 === 0 ? "host-a" : "host-missing", 1) : memberClaims("session-live"),
  );
  resetQueries();
  const fullAnswers = await Effect.runPromise(plane.validateResumeClaimsBatch(full));
  check(
    `a full batch of ${REMOTE_RESUME_BATCH_LIMIT} claims makes two replica queries, one primary query for the unknown host and answers each claim`,
    fullAnswers.length === REMOTE_RESUME_BATCH_LIMIT &&
      fullAnswers.every((valid, index) => valid === (index % 2 === 1 || index % 4 === 0)) &&
      replicaQueries.length === 2 &&
      queries.length === 1,
    { answers: fullAnswers.length, replicaQueries: replicaQueries.length, primaryQueries: queries.length },
  );
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
