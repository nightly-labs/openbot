// Runs the real invitation acceptance of the account server on a migrated SQLite database. A member who
// opens a link again keeps their role, their sessions and the host auth epoch, and does not use a
// single-use link. A removed member cannot join again with a link that they still have, and a new
// invitation brings them back. The cap of outstanding single-use invitations holds when owners create
// them at the same time.
//
// Run: bun run test:invite-acceptance
// It writes .openbot-build/invite-acceptance-e2e/report.json and exits non-zero on a failure.
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { RemoteControlPlane } from "../src/server/remote-control-plane";
import type { AuthUser } from "../src/server/types";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "invite-acceptance-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const HOST_ID = "host-1";
const HOUR = 60 * 60 * 1000;
const OWNER: AuthUser = {
  id: "user-owner",
  email: "owner@example.test",
  name: "Owner",
  avatarUrl: null,
  analyticsEnabled: null,
};
const MEMBER: AuthUser = {
  id: "user-member",
  email: "member@example.test",
  name: "Member",
  avatarUrl: null,
  analyticsEnabled: null,
};

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

const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
const privateJwk = await crypto.subtle.exportKey("jwk", privateKey);

/** A migrated database with two users and a host that the first one owns, and the real control plane over it. */
async function setup() {
  const database = await migratedDatabase();
  const now = Date.now();
  let clock = now;
  /** Moves the clock of the control plane, so that a later write has a later time. */
  const advance = (ms: number) => {
    clock += ms;
  };
  const addUser = database.prepare(
    "INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
  );
  for (const user of [OWNER, MEMBER]) addUser.run(user.id, `email:${user.email}`, user.email, user.name, now, now);
  database
    .prepare(
      "INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at) VALUES (?, ?, 'Host', ?, ?)",
    )
    .run(HOST_ID, OWNER.id, now, now);
  database
    .prepare(
      `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
       VALUES ('membership-owner', ?, ?, 'owner', 'active', ?, ?)`,
    )
    .run(HOST_ID, OWNER.id, now, now);
  const plane = new RemoteControlPlane(
    {
      DB: sqliteD1(database),
      REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "ticket-1" }),
      REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [{ ...publicJwk, kid: "ticket-1" }] }),
      REMOTE_TICKET_KEY_ID: "ticket-1",
    },
    { now: () => clock, schedule: () => undefined },
  );
  const epoch = () =>
    Number(database.prepare("SELECT auth_epoch FROM remote_hosts WHERE host_id = ?").get(HOST_ID)?.auth_epoch);
  const membership = () => {
    const row = database
      .prepare("SELECT membership_id, role, status FROM remote_memberships WHERE host_id = ? AND user_id = ?")
      .get(HOST_ID, MEMBER.id);
    return row ? { id: String(row.membership_id), role: String(row.role), status: String(row.status) } : null;
  };
  const invite = (inviteId: string) => {
    const row = database.prepare("SELECT use_count, used_at FROM remote_invites WHERE invite_id = ?").get(inviteId);
    return { useCount: Number(row?.use_count), usedAt: row?.used_at ?? null };
  };
  const openSessions = () =>
    Number(
      database
        .prepare("SELECT COUNT(*) AS count FROM remote_sessions WHERE host_id = ? AND user_id = ? AND ended_at IS NULL")
        .get(HOST_ID, MEMBER.id)?.count,
    );
  const openSession = (membershipId: string) =>
    database
      .prepare(
        `INSERT INTO remote_sessions(session_id, host_id, user_id, membership_id, started_at, ended_at, expires_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(randomUUID(), HOST_ID, MEMBER.id, membershipId, now, now + HOUR);
  const createInvite = (role: "admin" | "member", permanent: boolean) =>
    Effect.runPromise(plane.createInvite(OWNER, { hostId: HOST_ID, role, permanent }));
  return { database, now, advance, plane, epoch, membership, invite, openSessions, openSession, createInvite };
}

/** The error code of an operation, or null when it succeeds. */
async function failureCode<A, E extends object>(operation: Effect.Effect<A, E>) {
  const result = await Effect.runPromise(Effect.result(operation));
  if (result._tag === "Success") return { code: null, value: result.success };
  return {
    code: "code" in result.failure ? String(result.failure.code) : result.failure.constructor.name,
    value: null,
  };
}

async function aNewMemberJoins() {
  const { plane, epoch, membership, invite, createInvite } = await setup();
  const link = await createInvite("member", true);
  const before = epoch();
  const accepted = await failureCode(plane.acceptInvite(MEMBER, link.token));
  check("a new member joins with a permanent link", accepted.code === null, accepted);
  check("the new member is an active member", membership()?.role === "member" && membership()?.status === "active", {
    membership: membership(),
  });
  check("a join keeps the host auth epoch", epoch() === before, { before, after: epoch() });
  check("a join uses the permanent link once", invite(link.inviteId).useCount === 1, invite(link.inviteId));
}

async function aMemberAcceptsAgain() {
  const { plane, epoch, membership, invite, openSessions, openSession, createInvite } = await setup();
  const link = await createInvite("member", true);
  await failureCode(plane.acceptInvite(MEMBER, link.token));
  const joined = membership();
  if (!joined) throw new Error("The member did not join.");
  openSession(joined.id);
  const before = epoch();
  const again = await failureCode(plane.acceptInvite(MEMBER, link.token));
  check("a member can open the same link again", again.code === null, again);
  check("a second accept keeps the host auth epoch", epoch() === before, { before, after: epoch() });
  check("a second accept keeps the open session of the member", openSessions() === 1, { open: openSessions() });
  check("a second accept does not use the link again", invite(link.inviteId).useCount === 1, invite(link.inviteId));
  check("a second accept keeps the membership", membership()?.id === joined.id, {
    before: joined,
    after: membership(),
  });
}

async function anAdminKeepsTheRole() {
  const { plane, epoch, membership, createInvite } = await setup();
  const adminLink = await createInvite("admin", true);
  await failureCode(plane.acceptInvite(MEMBER, adminLink.token));
  const memberLink = await createInvite("member", true);
  const before = epoch();
  const accepted = await failureCode(plane.acceptInvite(MEMBER, memberLink.token));
  check("an admin can open a member link", accepted.code === null, accepted);
  check("an admin keeps the admin role", membership()?.role === "admin", { membership: membership() });
  check("the answer has the role that the admin keeps", accepted.value?.role === "admin", accepted.value);
  check("an admin who opens a member link keeps the host auth epoch", epoch() === before, {
    before,
    after: epoch(),
  });
}

async function aRemovedMemberStaysRemoved() {
  const { plane, epoch, membership, createInvite } = await setup();
  const link = await createInvite("member", true);
  await failureCode(plane.acceptInvite(MEMBER, link.token));
  const joined = membership();
  if (!joined) throw new Error("The member did not join.");
  await Effect.runPromise(plane.changeMembership(OWNER.id, { hostId: HOST_ID, membershipId: joined.id, revoke: true }));
  const before = epoch();
  const accepted = await failureCode(plane.acceptInvite(MEMBER, link.token));
  check("a removed member cannot join with a link that they kept", accepted.code === "invite_invalid", accepted);
  check("a removed member stays removed", membership()?.status === "revoked", { membership: membership() });
  check("a refused accept keeps the host auth epoch", epoch() === before, { before, after: epoch() });
}

async function aRemovedMemberJoinsWithANewInvitation() {
  const { plane, membership, advance, createInvite } = await setup();
  const old = await createInvite("member", true);
  await failureCode(plane.acceptInvite(MEMBER, old.token));
  const joined = membership();
  if (!joined) throw new Error("The member did not join.");
  advance(1000);
  await Effect.runPromise(plane.changeMembership(OWNER.id, { hostId: HOST_ID, membershipId: joined.id, revoke: true }));
  const withOld = await failureCode(plane.acceptInvite(MEMBER, old.token));
  check("a removed member cannot join with a link from before", withOld.code === "invite_invalid", withOld);
  advance(1000);
  const fresh = await createInvite("admin", false);
  const accepted = await failureCode(plane.acceptInvite(MEMBER, fresh.token));
  check("a removed member joins again with a new invitation", accepted.code === null, accepted);
  check(
    "the member who joins again is active, with the role of the new invitation",
    membership()?.status === "active" && membership()?.role === "admin" && membership()?.id === joined.id,
    { before: joined, after: membership() },
  );
}

async function aSingleUseLinkStaysUnusedForAMember() {
  const { plane, membership, invite, createInvite } = await setup();
  const permanent = await createInvite("member", true);
  await failureCode(plane.acceptInvite(MEMBER, permanent.token));
  const single = await createInvite("member", false);
  const accepted = await failureCode(plane.acceptInvite(MEMBER, single.token));
  check("a member can open a single-use link", accepted.code === null, accepted);
  check("a member does not use a single-use link", invite(single.inviteId).usedAt === null, invite(single.inviteId));
  check("a member keeps the membership after a single-use link", membership()?.status === "active", {
    membership: membership(),
  });
}

async function singleUseCapHolds() {
  const { database, now, plane } = await setup();
  const insert = database.prepare(
    `INSERT INTO remote_invites(
       invite_id, host_id, token_hash, email, role, created_by_user_id, expires_at, created_at, max_uses, use_count
     ) VALUES (?, ?, ?, NULL, 'member', ?, ?, ?, 1, 0)`,
  );
  for (let index = 0; index < 49; index += 1) {
    insert.run(`seed-${index}`, HOST_ID, `hash-${index}`, OWNER.id, now + HOUR, now);
  }
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      failureCode(plane.createInvite(OWNER, { hostId: HOST_ID, role: "member", permanent: false })),
    ),
  );
  const outstanding = Number(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM remote_invites
         WHERE host_id = ? AND max_uses IS NOT NULL AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      )
      .get(HOST_ID, now)?.count,
  );
  const refused = results.filter((result) => result.code === "invite_limit_reached").length;
  check("parallel creates stop at 50 outstanding single-use invitations", outstanding === 50, { outstanding });
  check("the creates above the cap fail with invite_limit_reached", refused === 4, {
    codes: results.map((result) => result.code),
  });
}

const scenarios = [
  aNewMemberJoins,
  aMemberAcceptsAgain,
  anAdminKeepsTheRole,
  aRemovedMemberStaysRemoved,
  aRemovedMemberJoinsWithANewInvitation,
  aSingleUseLinkStaysUnusedForAMember,
  singleUseCapHolds,
];
for (const scenario of scenarios) {
  try {
    await scenario();
  } catch (error) {
    check(scenario.name, false, { error: error instanceof Error ? error.message : String(error) });
  }
}

await mkdir(OUT, { recursive: true });
const report = { passed: checks.every((entry) => entry.passed), checks };
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const entry of checks) console.log(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!report.passed) process.exitCode = 1;
