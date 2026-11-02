// Runs the real account server authorization checks on a migrated SQLite database. Each scenario
// is one finding of the cloud authorization audit, and it fails if that access comes back.
//
// Run: bun run test:cloud-authorization
// It writes .openbot-build/cloud-authorization-e2e/report.json and exits non-zero on a failure.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { routeRequest } from "../../site-router/src/index";
import { BillingSales } from "../src/server/billing-sales";
import { enforceMarketplaceIngress } from "../src/server/marketplace-request-policy";
import { RemoteControlPlane } from "../src/server/remote-control-plane";
import type { AuthUser } from "../src/server/types";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "cloud-authorization-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const HOST_ID = "host-1";

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

function addUser(database: DatabaseSync, id: string): AuthUser {
  const email = `${id}@example.test`;
  database
    .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
    .run(id, `email:${id}`, email);
  return { id, email, name: null, avatarUrl: null, analyticsEnabled: null };
}

async function ticketKeys() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", privateKey);
  return {
    REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "ticket-1" }),
    REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [{ ...publicJwk, kid: "ticket-1" }] }),
    REMOTE_TICKET_KEY_ID: "ticket-1",
  };
}

/** A host with its owner, on a database with no Signal, and a clock that the scenario moves. */
async function remoteHost() {
  const database = await migratedDatabase();
  const owner = addUser(database, "owner");
  database
    .prepare(
      "INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at) VALUES (?, 'owner', 'Host', 1, 1)",
    )
    .run(HOST_ID);
  database
    .prepare(
      `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
       VALUES ('membership-owner', ?, 'owner', 'owner', 'active', 1, 1)`,
    )
    .run(HOST_ID);
  const clock = { now: Date.UTC(2026, 9, 17, 12) };
  const remote = new RemoteControlPlane({ DB: sqliteD1(database), ...(await ticketKeys()) }, { now: () => clock.now });
  return { database, owner, clock, remote };
}

/** The error code of a failed operation, or "ok". */
async function outcome<A, E>(operation: Effect.Effect<A, E>): Promise<string> {
  return Effect.runPromise(
    operation.pipe(
      Effect.match({
        onSuccess: () => "ok",
        onFailure: (error) =>
          typeof error === "object" && error !== null && "code" in error ? String(error.code) : "failure",
      }),
    ),
  );
}

function membershipStatus(database: DatabaseSync, userId: string) {
  const row = database
    .prepare("SELECT status, role FROM remote_memberships WHERE host_id = ? AND user_id = ?")
    .get(HOST_ID, userId);
  return row ? `${row.status}:${row.role}` : "none";
}

function membershipId(database: DatabaseSync, userId: string): string {
  return String(
    database
      .prepare("SELECT membership_id FROM remote_memberships WHERE host_id = ? AND user_id = ?")
      .get(HOST_ID, userId)?.membership_id,
  );
}

async function aRemovedMemberCannotRejoinWithAnOldInvite() {
  const { database, owner, clock, remote } = await remoteHost();
  const member = addUser(database, "member");
  const link = await Effect.runPromise(
    remote.createInvite(owner, { hostId: HOST_ID, role: "member", permanent: true }),
  );
  const spare = await Effect.runPromise(remote.createInvite(owner, { hostId: HOST_ID, role: "member" }));
  clock.now += 1_000;
  check("a member joins with the permanent link", (await outcome(remote.acceptInvite(member, link.token))) === "ok");
  clock.now += 1_000;
  await Effect.runPromise(
    remote.changeMembership(owner.id, {
      hostId: HOST_ID,
      membershipId: membershipId(database, member.id),
      revoke: true,
    }),
  );
  clock.now += 1_000;
  const again = await outcome(remote.acceptInvite(member, link.token));
  check("a removed member cannot rejoin with the permanent link", again === "invite_invalid", {
    outcome: again,
    membership: membershipStatus(database, member.id),
  });
  const spareOutcome = await outcome(remote.acceptInvite(member, spare.token));
  check(
    "a removed member cannot rejoin with an unused invite from before the removal",
    spareOutcome === "invite_invalid",
    {
      outcome: spareOutcome,
      membership: membershipStatus(database, member.id),
    },
  );
  const unused = database.prepare("SELECT used_at FROM remote_invites WHERE invite_id = ?").get(spare.inviteId);
  check("the refused invite stays unused", unused?.used_at === null, { unused });
  clock.now += 1_000;
  const fresh = await Effect.runPromise(remote.createInvite(owner, { hostId: HOST_ID, role: "member" }));
  clock.now += 1_000;
  const freshOutcome = await outcome(remote.acceptInvite(member, fresh.token));
  check("a removed member rejoins with an invite made after the removal", freshOutcome === "ok", {
    outcome: freshOutcome,
    membership: membershipStatus(database, member.id),
  });
}

async function aMemberWhoLeftRejoinsWithTheLink() {
  const { database, owner, clock, remote } = await remoteHost();
  const member = addUser(database, "member");
  const link = await Effect.runPromise(
    remote.createInvite(owner, { hostId: HOST_ID, role: "member", permanent: true }),
  );
  clock.now += 1_000;
  await Effect.runPromise(remote.acceptInvite(member, link.token));
  clock.now += 1_000;
  await Effect.runPromise(
    remote.changeMembership(member.id, {
      hostId: HOST_ID,
      membershipId: membershipId(database, member.id),
      revoke: true,
    }),
  );
  clock.now += 1_000;
  const rejoined = await outcome(remote.acceptInvite(member, link.token));
  check("a member who left rejoins with the permanent link", rejoined === "ok", {
    outcome: rejoined,
    membership: membershipStatus(database, member.id),
  });
}

async function aRoleChangeKeepsANewInviteValid() {
  const { database, owner, clock, remote } = await remoteHost();
  const member = addUser(database, "member");
  const first = await Effect.runPromise(remote.createInvite(owner, { hostId: HOST_ID, role: "member" }));
  clock.now += 1_000;
  await Effect.runPromise(remote.acceptInvite(member, first.token));
  const id = membershipId(database, member.id);
  clock.now += 1_000;
  await Effect.runPromise(remote.changeMembership(owner.id, { hostId: HOST_ID, membershipId: id, revoke: true }));
  clock.now += 1_000;
  const fresh = await Effect.runPromise(remote.createInvite(owner, { hostId: HOST_ID, role: "member" }));
  clock.now += 1_000;
  await Effect.runPromise(remote.changeMembership(owner.id, { hostId: HOST_ID, membershipId: id, role: "admin" }));
  clock.now += 1_000;
  const joined = await outcome(remote.acceptInvite(member, fresh.token));
  check("a role change of a removed member does not cancel a newer invite", joined === "ok", {
    outcome: joined,
    membership: membershipStatus(database, member.id),
  });
}

/** The host's auth epoch and its queued epoch events. */
function hostEpoch(database: DatabaseSync) {
  return {
    authEpoch: Number(
      database.prepare("SELECT auth_epoch FROM remote_hosts WHERE host_id = ?").get(HOST_ID)?.auth_epoch,
    ),
    epochEvents: Number(
      database
        .prepare(
          "SELECT count(*) AS count FROM remote_auth_events WHERE json_extract(payload, '$.type') = 'remote-auth-changed'",
        )
        .get()?.count,
    ),
  };
}

/** Whether a session is open, and how many end events it has. */
function sessionState(database: DatabaseSync, sessionId: string) {
  return {
    open:
      database.prepare("SELECT ended_at FROM remote_sessions WHERE session_id = ?").get(sessionId)?.ended_at === null,
    endedEvents: Number(
      database
        .prepare(
          `SELECT count(*) AS count FROM remote_auth_events
            WHERE json_extract(payload, '$.type') = 'remote-session-ended' AND json_extract(payload, '$.sessionId') = ?`,
        )
        .get(sessionId)?.count,
    ),
  };
}

function openSession(database: DatabaseSync, sessionId: string, userId: string, now: number) {
  database
    .prepare(
      `INSERT INTO remote_sessions(session_id, host_id, user_id, membership_id, started_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(sessionId, HOST_ID, userId, membershipId(database, userId), now, now + 60 * 60 * 1_000);
}

/**
 * A new auth epoch makes Signal drop the host and every connected member. A role change ends only
 * the sessions of the member whose role changed; a removal still changes the epoch.
 */
async function aRoleChangeKeepsTheHostConnected() {
  const { database, owner, clock, remote } = await remoteHost();
  const member = addUser(database, "member");
  const invite = await Effect.runPromise(remote.createInvite(owner, { hostId: HOST_ID, role: "member" }));
  clock.now += 1_000;
  await Effect.runPromise(remote.acceptInvite(member, invite.token));
  const id = membershipId(database, member.id);
  const before = hostEpoch(database);
  for (const [sessionId, role] of [
    ["session-promote", "admin"],
    ["session-demote", "member"],
  ] as const) {
    clock.now += 1_000;
    openSession(database, sessionId, member.id, clock.now);
    await Effect.runPromise(remote.changeMembership(owner.id, { hostId: HOST_ID, membershipId: id, role }));
    const after = hostEpoch(database);
    const session = sessionState(database, sessionId);
    check(
      `a change to ${role} keeps the host auth epoch and ends only the member's session`,
      membershipStatus(database, member.id) === `active:${role}` &&
        after.authEpoch === before.authEpoch &&
        after.epochEvents === before.epochEvents &&
        !session.open &&
        session.endedEvents === 1,
      { before, after, session },
    );
  }
  clock.now += 1_000;
  openSession(database, "session-revoke", member.id, clock.now);
  await Effect.runPromise(remote.changeMembership(owner.id, { hostId: HOST_ID, membershipId: id, revoke: true }));
  const revoked = hostEpoch(database);
  const session = sessionState(database, "session-revoke");
  check(
    "a removal still changes the host auth epoch",
    revoked.authEpoch === before.authEpoch + 1 &&
      revoked.epochEvents === before.epochEvents + 1 &&
      !session.open &&
      session.endedEvents === 1,
    { before, revoked, session },
  );
}

/** A host with a member who joined with a permanent link. */
async function hostWithLinkMember() {
  const host = await remoteHost();
  const member = addUser(host.database, "member");
  const link = await Effect.runPromise(
    host.remote.createInvite(host.owner, { hostId: HOST_ID, role: "member", permanent: true }),
  );
  host.clock.now += 1_000;
  await Effect.runPromise(host.remote.acceptInvite(member, link.token));
  host.clock.now += 1_000;
  return { ...host, member, link, id: membershipId(host.database, member.id) };
}

async function aRemovedMemberCannotUndoTheRemovalByLeaving() {
  const { database, owner, clock, remote, member, link, id } = await hostWithLinkMember();
  await Effect.runPromise(remote.changeMembership(owner.id, { hostId: HOST_ID, membershipId: id, revoke: true }));
  clock.now += 1_000;
  const left = await outcome(remote.changeMembership(member.id, { hostId: HOST_ID, membershipId: id, revoke: true }));
  clock.now += 1_000;
  const again = await outcome(remote.acceptInvite(member, link.token));
  check("a removed member who leaves again still cannot rejoin with the permanent link", again === "invite_invalid", {
    left,
    outcome: again,
    membership: membershipStatus(database, member.id),
  });
}

async function aRepeatedRemovalKeepsANewInviteValid() {
  const { database, owner, clock, remote, member, id } = await hostWithLinkMember();
  await Effect.runPromise(remote.changeMembership(owner.id, { hostId: HOST_ID, membershipId: id, revoke: true }));
  clock.now += 1_000;
  const fresh = await Effect.runPromise(remote.createInvite(owner, { hostId: HOST_ID, role: "member" }));
  clock.now += 1_000;
  await Effect.runPromise(remote.changeMembership(owner.id, { hostId: HOST_ID, membershipId: id, revoke: true }));
  clock.now += 1_000;
  const joined = await outcome(remote.acceptInvite(member, fresh.token));
  check("a second removal of a removed member does not cancel a newer invite", joined === "ok", {
    outcome: joined,
    membership: membershipStatus(database, member.id),
  });
}

async function aRevokeFromTheOldWorkerCountsAsARemoval() {
  const { database, clock, remote, member, link, id } = await hostWithLinkMember();
  // The Worker before migration 0036 revokes the member and does not write removed_at.
  database
    .prepare("UPDATE remote_memberships SET status = 'revoked', updated_at = ? WHERE membership_id = ?")
    .run(clock.now, id);
  clock.now += 1_000;
  const again = await outcome(remote.acceptInvite(member, link.token));
  check("a revoke with no removal time blocks an earlier invite", again === "invite_invalid", {
    outcome: again,
    membership: membershipStatus(database, member.id),
  });
}

async function anOldRevokeCountsAsARemoval() {
  const database = new DatabaseSync(":memory:");
  const names = (await readdir(MIGRATIONS)).sort();
  const removal = names.indexOf("0036_membership_removed_at.sql");
  for (const name of names.slice(0, removal)) database.exec(await readFile(join(MIGRATIONS, name), "utf8"));
  addUser(database, "owner");
  addUser(database, "member");
  database
    .prepare(
      "INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at) VALUES (?, 'owner', 'Host', 1, 1)",
    )
    .run(HOST_ID);
  database
    .prepare(
      `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
       VALUES ('m-owner', ?, 'owner', 'owner', 'active', 1, 1), ('m-member', ?, 'member', 'member', 'revoked', 2, 5)`,
    )
    .run(HOST_ID, HOST_ID);
  for (const name of names.slice(removal)) database.exec(await readFile(join(MIGRATIONS, name), "utf8"));
  const rows = database.prepare("SELECT user_id, status, updated_at, removed_at FROM remote_memberships").all();
  check(
    "the migration keeps each membership and marks an old revoke as a removal",
    rows.length === 2 &&
      rows.some((row) => row.user_id === "owner" && row.status === "active" && row.removed_at === null) &&
      rows.some((row) => row.user_id === "member" && row.status === "revoked" && row.removed_at === 5),
    { rows },
  );
}

async function aDemotionClosesTheInvitesOfTheAdmin() {
  const { database, owner, clock, remote } = await remoteHost();
  const admin = addUser(database, "admin");
  const adminInvite = await Effect.runPromise(remote.createInvite(owner, { hostId: HOST_ID, role: "admin" }));
  clock.now += 1_000;
  await Effect.runPromise(remote.acceptInvite(admin, adminInvite.token));
  const link = await Effect.runPromise(
    remote.createInvite(admin, { hostId: HOST_ID, role: "member", permanent: true }),
  );
  clock.now += 1_000;
  await Effect.runPromise(
    remote.changeMembership(owner.id, {
      hostId: HOST_ID,
      membershipId: membershipId(database, admin.id),
      role: "member",
    }),
  );
  const row = database.prepare("SELECT revoked_at FROM remote_invites WHERE invite_id = ?").get(link.inviteId);
  check("a demotion closes the invites of the admin", row?.revoked_at === clock.now, { row });
}

async function anOldInviteOfAFormerAdminCloses() {
  const database = new DatabaseSync(":memory:");
  const names = (await readdir(MIGRATIONS)).sort();
  const closing = names.indexOf("0037_close_invites_of_former_admins.sql");
  for (const name of names.slice(0, closing)) database.exec(await readFile(join(MIGRATIONS, name), "utf8"));
  for (const id of ["owner", "admin", "former"]) addUser(database, id);
  database
    .prepare(
      "INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at) VALUES (?, 'owner', 'Host', 1, 1)",
    )
    .run(HOST_ID);
  database
    .prepare(
      `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
       VALUES ('m-owner', ?, 'owner', 'owner', 'active', 1, 1), ('m-admin', ?, 'admin', 'admin', 'active', 1, 1),
              ('m-former', ?, 'former', 'member', 'active', 1, 1)`,
    )
    .run(HOST_ID, HOST_ID, HOST_ID);
  const invite = database.prepare(
    `INSERT INTO remote_invites(invite_id, host_id, token_hash, role, created_by_user_id, expires_at, created_at, max_uses, use_count)
     VALUES (?, ?, ?, 'member', ?, 9999999999999, 1, ?, 0)`,
  );
  invite.run("by-owner", HOST_ID, "hash-owner", "owner", null);
  invite.run("by-admin", HOST_ID, "hash-admin", "admin", 1);
  invite.run("by-former", HOST_ID, "hash-former", "former", null);
  for (const name of names.slice(closing)) database.exec(await readFile(join(MIGRATIONS, name), "utf8"));
  const rows = database.prepare("SELECT invite_id, revoked_at FROM remote_invites ORDER BY invite_id").all();
  const revoked = Object.fromEntries(rows.map((row) => [row.invite_id, row.revoked_at !== null]));
  check(
    "the migration closes only the invites of a former admin",
    rows.length === 3 &&
      revoked["by-former"] === true &&
      revoked["by-owner"] === false &&
      revoked["by-admin"] === false,
    { rows },
  );
}

async function anInviteEndsWithTheAdminWhoMadeIt() {
  const { database, owner, clock, remote } = await remoteHost();
  const admin = addUser(database, "admin");
  const other = addUser(database, "other");
  const control = addUser(database, "control");
  const adminInvite = await Effect.runPromise(remote.createInvite(owner, { hostId: HOST_ID, role: "admin" }));
  clock.now += 1_000;
  await Effect.runPromise(remote.acceptInvite(admin, adminInvite.token));
  const link = await Effect.runPromise(remote.createInvite(admin, { hostId: HOST_ID, role: "admin", permanent: true }));
  const ownerLink = await Effect.runPromise(
    remote.createInvite(owner, { hostId: HOST_ID, role: "member", permanent: true }),
  );
  clock.now += 1_000;
  await Effect.runPromise(
    remote.changeMembership(owner.id, {
      hostId: HOST_ID,
      membershipId: membershipId(database, admin.id),
      revoke: true,
    }),
  );
  clock.now += 1_000;
  const listed = await Effect.runPromise(remote.listInvites(owner.id, HOST_ID));
  const closed = listed.find((invite) => invite.inviteId === link.inviteId);
  const kept = listed.find((invite) => invite.inviteId === ownerLink.inviteId);
  check(
    "the removal closes the invites of the admin and keeps the owner's",
    Boolean(closed?.revokedAt) && kept?.revokedAt === null,
    {
      closed,
      kept,
    },
  );
  const preview = await outcome(remote.previewInvite(link.token));
  check("the preview of an invite from a removed admin is invalid", preview === "invite_invalid", { preview });
  const joined = await outcome(remote.acceptInvite(other, link.token));
  check("an invite from an admin who was removed admits nobody", joined === "invite_invalid", {
    outcome: joined,
    membership: membershipStatus(database, other.id),
  });
  const ownerJoined = await outcome(remote.acceptInvite(control, ownerLink.token));
  check("the owner's link still admits a new member", ownerJoined === "ok", {
    outcome: ownerJoined,
    membership: membershipStatus(database, control.id),
  });
}

async function theJwksNeverPublishesAPrivateKey() {
  const database = await migratedDatabase();
  const keys = await ticketKeys();
  const privateJwk = JSON.parse(keys.REMOTE_TICKET_PRIVATE_JWK);
  // An operator pastes the private key into the public set by mistake.
  const remote = new RemoteControlPlane({
    DB: sqliteD1(database),
    ...keys,
    REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [privateJwk] }),
  });
  const published = remote.publicJwks().keys;
  const leaked = published.flatMap((key) =>
    ["d", "p", "q", "dp", "dq", "qi", "oth", "k"].filter((name) => name in key),
  );
  check("the JWKS does not publish the private members of a key", leaked.length === 0, { leaked });
  const [key] = published;
  check(
    "the JWKS keeps the public members of the key",
    key?.kid === "ticket-1" && key.kty === "EC" && key.x === privateJwk.x && key.y === privateJwk.y,
  );
}

async function aCheckoutReturnStaysOnTheAccountSite() {
  const database = await migratedDatabase();
  addUser(database, "buyer");
  const sales = new BillingSales({
    database: sqliteD1(database),
    fetch: () => Promise.reject(new Error("No network in this test.")),
    clientId: undefined,
    clientSecret: undefined,
  });
  const checkout = (sessionId: string, returnUrl: string) =>
    outcome(
      sales.checkout({
        sessionId,
        returnToken: crypto.randomUUID(),
        userId: "buyer",
        serverId: "server-1",
        plan: "starter",
        interval: "month",
        currency: "usd",
        amount: 1_000,
        returnUrl,
        createdAt: Date.UTC(2026, 9, 17, 12),
      }),
    );
  const sameSite = await checkout("cs_same_site", "/billing/return?server=server-1");
  check("a checkout keeps a return path on the account site", sameSite === "ok", { outcome: sameSite });
  for (const returnUrl of ["//evil.example/app", "/\\evil.example/app"]) {
    const result = await checkout(`cs_${checks.length}`, returnUrl);
    check(`a checkout refuses the return address ${returnUrl}`, result === "invalid_input", { outcome: result });
  }
}

async function aSiteServesOnlyItsOwnFiles() {
  const hostname = "demo.openbot.site";
  const prefix = "sites/site-1/deployments/deployment-1/";
  const manifest = {
    version: 1,
    status: "active",
    siteId: "site-1",
    deploymentId: "deployment-1",
    expiresAt: Date.UTC(2027, 0, 1),
    spaFallback: false,
    files: { "index.html": { key: `${prefix}index.html`, size: 5, mimeType: "text/html" } },
  };
  const object = (key: string, text: string): R2ObjectBody => ({
    key,
    version: "1",
    size: text.length,
    etag: "etag",
    httpEtag: '"etag"',
    checksums: { toJSON: () => ({}) },
    uploaded: new Date(0),
    storageClass: "Standard",
    writeHttpMetadata: () => {},
    get body() {
      return new Response(text).body ?? new ReadableStream();
    },
    bodyUsed: false,
    arrayBuffer: () => new Response(text).arrayBuffer(),
    bytes: () => new Response(text).bytes(),
    text: () => Promise.resolve(text),
    json: <T>(): Promise<T> => Promise.resolve(JSON.parse(text)),
    blob: () => new Response(text).blob(),
  });
  const reads: string[] = [];
  const env = {
    SITE_SERVE_ENABLED: "true",
    SITES: {
      get: async (key: string) => {
        reads.push(String(key));
        if (key === `routes/${hostname}.json`) return object(key, JSON.stringify(manifest));
        if (key === `${prefix}index.html`) return object(key, "hello");
        return null;
      },
    },
  };
  const status = async (path: string) =>
    (await Effect.runPromise(routeRequest(new Request(`https://${hostname}${path}`), env, Date.UTC(2026, 9, 17))))
      .status;
  check("a site serves its own file", (await status("/")) === 200);
  for (const path of ["/constructor", "/__proto__", "/toString"]) {
    reads.length = 0;
    const result = await status(path);
    const outside = reads.filter((key) => !key.startsWith("routes/") && !key.startsWith("blocks/"));
    check(`a site has no file at ${path}`, result === 404 && outside.length === 0, { status: result, outside });
  }
}

// A client sets `X-Forwarded-For` itself. A new value for each request must not give it a new limit.
async function aRateLimitIgnoresForwardedFor() {
  const keys: string[] = [];
  const bindings = {
    MARKETPLACE_INGRESS_RATE_LIMITER: {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: true };
      },
    },
  };
  const send = (headers: Record<string, string>) =>
    Effect.runPromise(enforceMarketplaceIngress(new Request("https://openbot.run/v1/skills", { headers }), bindings));
  await send({ "CF-Connecting-IP": "203.0.113.7", "X-Forwarded-For": "198.51.100.1" });
  await send({ "CF-Connecting-IP": "203.0.113.7", "X-Forwarded-For": "198.51.100.2" });
  await send({ "X-Forwarded-For": "198.51.100.3" });
  await send({ "X-Forwarded-For": "198.51.100.4" });
  check(
    "a rate limit uses the Cloudflare address, not X-Forwarded-For",
    keys[0] === keys[1] && keys[0] === "ip:203.0.113.7",
    keys,
  );
  check("a request with no Cloudflare address does not get a new key from X-Forwarded-For", keys[2] === keys[3], keys);

  // One IPv6 subscriber has a full /64. A new address in it must not give it a new limit.
  keys.length = 0;
  for (const address of [
    "2001:db8:1:2::1",
    "2001:0db8:0001:0002:ffff:eeee:dddd:cccc",
    "2001:DB8:1:2::",
    "2001:db8:1:3::1",
    "::1",
  ])
    await send({ "CF-Connecting-IP": address });
  check(
    "a rate limit counts the addresses of one IPv6 /64 together",
    keys[0] === "ip:2001:db8:1:2::/64" && keys[1] === keys[0] && keys[2] === keys[0],
    keys,
  );
  check(
    "another IPv6 /64 has its own rate limit",
    keys[3] === "ip:2001:db8:1:3::/64" && keys[4] === "ip:0:0:0:0::/64",
    keys,
  );
}

const scenarios = [
  aRemovedMemberCannotRejoinWithAnOldInvite,
  aMemberWhoLeftRejoinsWithTheLink,
  aRoleChangeKeepsANewInviteValid,
  aRoleChangeKeepsTheHostConnected,
  aRemovedMemberCannotUndoTheRemovalByLeaving,
  aRepeatedRemovalKeepsANewInviteValid,
  aRevokeFromTheOldWorkerCountsAsARemoval,
  anOldRevokeCountsAsARemoval,
  anInviteEndsWithTheAdminWhoMadeIt,
  aDemotionClosesTheInvitesOfTheAdmin,
  anOldInviteOfAFormerAdminCloses,
  theJwksNeverPublishesAPrivateKey,
  aCheckoutReturnStaysOnTheAccountSite,
  aSiteServesOnlyItsOwnFiles,
  aRateLimitIgnoresForwardedFor,
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
