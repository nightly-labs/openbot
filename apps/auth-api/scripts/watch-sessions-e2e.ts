import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { REMOTE_TICKET_AUDIENCE } from "@openbot/contracts/signal-protocol/ticket";
import {
  WATCH_SESSION_TTL_MS,
  WATCH_TICKET_AUDIENCE,
  WATCH_TICKET_TTL_SECONDS,
  watchTicketProofMessage,
} from "@openbot/contracts/signal-protocol/watch-relay";
import { Effect } from "effect";
import { createLocalJWKSet, jwtVerify } from "jose";
import { encodeBase64Url, sha256 } from "../src/server/crypto";
import { RemoteControlPlane } from "../src/server/remote-control-plane";
import { WATCH_SESSIONS_PER_USER, WatchSessions } from "../src/server/watch-sessions";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "watch-sessions-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const SIGNAL_URL = "wss://signal.example.test";
const OWNER = "user-owner";
const OTHER = "user-other";
const HOST_ID = "host-1";
const FOREIGN_HOST_ID = "host-2";
const PARENT_LIFETIME_MS = 90 * 24 * 60 * 60_000;
const SHORT_PARENT_LIFETIME_MS = 2 * 24 * 60 * 60_000;
const CLAIM_NAMES = [
  "aud",
  "authEpoch",
  "clientPublicKey",
  "exp",
  "hostId",
  "iat",
  "jti",
  "membershipId",
  "role",
  "userId",
  "watchSessionId",
];

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

async function result<A, E extends object>(operation: Effect.Effect<A, E>) {
  const outcome = await Effect.runPromise(Effect.result(operation));
  if (outcome._tag === "Success") return { code: null, status: 200, value: outcome.success };
  const failure = outcome.failure;
  return {
    code: "code" in failure ? String(failure.code) : failure.constructor.name,
    status: "status" in failure ? Number(failure.status) : 500,
    value: null,
  };
}

const ticketKeys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const ticketPublicJwk = { ...(await crypto.subtle.exportKey("jwk", ticketKeys.publicKey)), kid: "ticket-1" };
const ticketPrivateJwk = { ...(await crypto.subtle.exportKey("jwk", ticketKeys.privateKey)), kid: "ticket-1" };

interface WatchKey {
  publicKey: string;
  privateKey: CryptoKey;
}

async function watchKey(): Promise<WatchKey> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey: encodeBase64Url(raw), privateKey: pair.privateKey };
}

async function proof(key: WatchKey, watchSessionId: string, hostId: string, ts: number) {
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key.privateKey,
    new TextEncoder().encode(watchTicketProofMessage(watchSessionId, hostId, ts)),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

async function setup(parentLifetimeMs = PARENT_LIFETIME_MS) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of (await readdir(MIGRATIONS)).sort()) database.exec(await readFile(join(MIGRATIONS, name), "utf8"));
  const clock = { now: Date.now() };
  const now = clock.now;
  const phoneToken = "phone-session-token";
  const otherToken = "other-session-token";
  const phoneHash = await Effect.runPromise(sha256(phoneToken));
  const otherHash = await Effect.runPromise(sha256(otherToken));
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('${OWNER}', 'email:owner@example.test', 'owner@example.test', 'Owner', NULL, ${now}, ${now}),
           ('${OTHER}', 'email:other@example.test', 'other@example.test', 'Other', NULL, ${now}, ${now});
    INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
    VALUES ('phone', '${OWNER}', '${phoneHash}', ${now + parentLifetimeMs}, ${now}, ${now}),
           ('other-phone', '${OTHER}', '${otherHash}', ${now + PARENT_LIFETIME_MS}, ${now}, ${now});
    INSERT INTO mobile_auth_sessions(session_id, user_id, device_id, device_name, platform, created_at)
    VALUES ('phone', '${OWNER}', 'device-1', 'iPhone', 'ios', ${now});
    INSERT INTO remote_hosts(host_id, owner_user_id, name, auth_epoch, created_at, updated_at)
    VALUES ('${HOST_ID}', '${OTHER}', 'Studio', 3, ${now}, ${now}),
           ('${FOREIGN_HOST_ID}', '${OTHER}', 'Private', 1, ${now}, ${now});
    INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
    VALUES ('membership-owner', '${HOST_ID}', '${OWNER}', 'member', 'active', ${now}, ${now}),
           ('membership-other', '${HOST_ID}', '${OTHER}', 'owner', 'active', ${now}, ${now}),
           ('membership-foreign', '${FOREIGN_HOST_ID}', '${OTHER}', 'owner', 'active', ${now}, ${now});
  `);
  const plane = new RemoteControlPlane(
    {
      DB: sqliteD1(database),
      REMOTE_TICKET_PRIVATE_JWK: JSON.stringify(ticketPrivateJwk),
      REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [ticketPublicJwk] }),
      REMOTE_TICKET_KEY_ID: "ticket-1",
      REMOTE_SIGNAL_URL: SIGNAL_URL,
    },
    { now: () => clock.now, schedule: () => undefined },
  );
  const sessions = new WatchSessions({
    database: sqliteD1(database),
    now: () => clock.now,
    issueTicket: (input) => plane.issueWatchTicket(input),
    allowTicket: null,
  });
  const pair = (key: WatchKey, token = phoneToken, userId = OWNER) =>
    result(sessions.create({ userId, authSessionToken: token, publicKey: key.publicKey }));
  const ticket = async (
    watchToken: string,
    key: WatchKey,
    watchSessionId: string,
    options: { hostId?: string; ts?: number } = {},
  ) => {
    const hostId = options.hostId ?? HOST_ID;
    const ts = options.ts ?? clock.now;
    return result(
      sessions.issueTicket(watchToken, { hostId, ts, proof: await proof(key, watchSessionId, hostId, ts) }),
    );
  };
  const row = (watchSessionId: string) =>
    database
      .prepare("SELECT revoked_at, last_used_at, expires_at FROM watch_sessions WHERE watch_session_id = ?")
      .get(watchSessionId);
  const activeCount = () =>
    Number(
      database
        .prepare("SELECT COUNT(*) AS count FROM watch_sessions WHERE user_id = ? AND revoked_at IS NULL")
        .get(OWNER)?.count,
    );
  return { database, clock, plane, sessions, pair, ticket, row, activeCount, phoneToken, phoneHash, otherToken };
}

async function aPairedWatchGetsATicket() {
  const { database, clock, plane, pair, ticket, row } = await setup();
  const key = await watchKey();
  const created = await pair(key);
  const session = created.value;
  check("the phone pairs a watch", created.code === null && session !== null, created.code);
  if (!session) return;
  check(
    "the watch session lasts 30 days when the phone session lasts longer",
    session.expiresAt === clock.now + WATCH_SESSION_TTL_MS,
    { expiresAt: session.expiresAt, now: clock.now },
  );
  check("the watch token is 32 random bytes in base64url", /^[A-Za-z0-9_-]{43}$/u.test(session.token));
  const storedHash = database
    .prepare("SELECT token_hash FROM watch_sessions WHERE watch_session_id = ?")
    .get(session.watchSessionId)?.token_hash;
  check(
    "the database keeps only the hash of the watch token",
    storedHash === (await Effect.runPromise(sha256(session.token))) && storedHash !== session.token,
  );

  clock.now += 60_000;
  const issued = await ticket(session.token, key, session.watchSessionId);
  check("the watch gets a ticket with a valid proof", issued.code === null, issued.code);
  if (!issued.value) return;
  check("the ticket answer names the Signal URL", issued.value.signalUrl === SIGNAL_URL, issued.value.signalUrl);
  check(
    "the ticket lasts the watch ticket lifetime",
    issued.value.expiresAt === (Math.floor(clock.now / 1_000) + WATCH_TICKET_TTL_SECONDS) * 1_000,
    { expiresAt: issued.value.expiresAt },
  );
  const keys = createLocalJWKSet(plane.publicJwks());
  const verified = await jwtVerify(issued.value.ticket, keys, {
    audience: WATCH_TICKET_AUDIENCE,
    algorithms: ["ES256"],
    currentDate: new Date(clock.now),
  }).then(
    (value) => value,
    () => null,
  );
  check("the public JWKS of remote tickets verifies the watch ticket", verified !== null);
  const claims = verified?.payload;
  check(
    "the ticket has exactly the watch ticket claims",
    JSON.stringify(Object.keys(claims ?? {}).sort()) === JSON.stringify(CLAIM_NAMES),
    Object.keys(claims ?? {}),
  );
  check(
    "the ticket claims name the watch, the host membership and the watch key",
    claims?.aud === WATCH_TICKET_AUDIENCE &&
      claims.watchSessionId === session.watchSessionId &&
      claims.hostId === HOST_ID &&
      claims.userId === OWNER &&
      claims.membershipId === "membership-owner" &&
      claims.role === "member" &&
      claims.authEpoch === 3 &&
      claims.clientPublicKey === key.publicKey &&
      typeof claims.jti === "string",
    claims,
  );
  check("the ticket header names the remote ticket key", verified?.protectedHeader.kid === "ticket-1");
  const asRemote = await jwtVerify(issued.value.ticket, keys, {
    audience: REMOTE_TICKET_AUDIENCE,
    currentDate: new Date(clock.now),
  }).then(
    () => true,
    () => false,
  );
  check("a remote ticket check refuses the watch ticket", !asRemote);
  check("a ticket updates the last use of the watch session", row(session.watchSessionId)?.last_used_at === clock.now);
}

async function refusedTicketsGiveNoTicket() {
  const { database, clock, pair, ticket, row } = await setup();
  const key = await watchKey();
  const session = (await pair(key)).value;
  if (!session) return check("refused tickets: the phone pairs a watch", false);
  const lastUse = row(session.watchSessionId)?.last_used_at;
  clock.now += 60_000;

  const wrongKey = await ticket(session.token, await watchKey(), session.watchSessionId);
  check(
    "a proof from another key is refused",
    wrongKey.code === "watch_proof_invalid" && wrongKey.status === 401,
    wrongKey,
  );

  const otherMessage = await ticket(session.token, key, "another-watch-session");
  check("a proof for another watch session is refused", otherMessage.code === "watch_proof_invalid", otherMessage);

  const stale = await ticket(session.token, key, session.watchSessionId, { ts: clock.now - 6 * 60_000 });
  check(
    "a proof older than the clock skew is refused",
    stale.code === "watch_clock_skew" && stale.status === 400,
    stale,
  );

  const ahead = await ticket(session.token, key, session.watchSessionId, { ts: clock.now + 6 * 60_000 });
  check("a proof from a clock that is too far ahead is refused", ahead.code === "watch_clock_skew", ahead);

  const foreign = await ticket(session.token, key, session.watchSessionId, { hostId: FOREIGN_HOST_ID });
  check(
    "a host where the account is not a member is refused",
    foreign.code === "remote_permission_denied" && foreign.status === 403,
    foreign,
  );

  const unknownToken = await ticket("not-a-watch-token", key, session.watchSessionId);
  check(
    "an unknown watch token is refused",
    unknownToken.code === "watch_session_ended" && unknownToken.status === 401,
    unknownToken,
  );

  database.prepare("UPDATE remote_memberships SET status = 'revoked' WHERE membership_id = 'membership-owner'").run();
  const revokedMember = await ticket(session.token, key, session.watchSessionId);
  check("a revoked membership is refused", revokedMember.code === "remote_permission_denied", revokedMember);
  check("a refused ticket does not change the last use", row(session.watchSessionId)?.last_used_at === lastUse);
}

async function theParentSessionEndsTheWatch() {
  const { database, clock, plane, pair, ticket, row, phoneHash } = await setup();
  const key = await watchKey();
  const session = (await pair(key)).value;
  if (!session) return check("parent: the phone pairs a watch", false);

  database.prepare("UPDATE auth_sessions SET expires_at = ? WHERE id = 'phone'").run(clock.now + 1_000);
  clock.now += 2_000;
  const expired = await ticket(session.token, key, session.watchSessionId);
  check("an expired phone session ends the watch session", expired.code === "watch_session_ended", expired);

  database.prepare("UPDATE auth_sessions SET expires_at = ? WHERE id = 'phone'").run(clock.now + PARENT_LIFETIME_MS);
  const back = await ticket(session.token, key, session.watchSessionId);
  check("the watch works again while its phone session is valid", back.code === null, back.code);

  await Effect.runPromise(plane.endAccountSession(OWNER, phoneHash));
  const revoked = await ticket(session.token, key, session.watchSessionId);
  check("a phone that signs out ends the watch session", revoked.code === "watch_session_ended", revoked);
  check("signing out the phone revokes the watch session row", row(session.watchSessionId)?.revoked_at === clock.now);
}

async function aShortPhoneSessionLimitsTheWatch() {
  const { clock, pair } = await setup(SHORT_PARENT_LIFETIME_MS);
  const created = (await pair(await watchKey())).value;
  check(
    "the watch session ends with a phone session that ends first",
    created?.expiresAt === clock.now + SHORT_PARENT_LIFETIME_MS,
    created?.expiresAt,
  );
  check(
    "a watch session that ends with its phone session still is not longer than 30 days",
    (created?.expiresAt ?? 0) < clock.now + WATCH_SESSION_TTL_MS,
  );
}

async function pairingRulesKeepFiveWatches() {
  const { database, clock, pair, ticket, sessions, activeCount, otherToken } = await setup();
  const key = await watchKey();
  const first = (await pair(key)).value;
  clock.now += 1_000;
  const second = (await pair(key)).value;
  if (!first || !second) return check("pairing: the phone pairs a watch twice", false);
  check("pairing the same key again makes a new session", first.watchSessionId !== second.watchSessionId);
  const old = await ticket(first.token, key, first.watchSessionId);
  check("pairing the same key again ends the old session", old.code === "watch_session_ended", old);
  const fresh = await ticket(second.token, key, second.watchSessionId);
  check("the new session of the same key works", fresh.code === null, fresh.code);

  const ids = [second.watchSessionId];
  for (let index = 0; index < WATCH_SESSIONS_PER_USER; index += 1) {
    clock.now += 1_000;
    const created = (await pair(await watchKey())).value;
    if (created) ids.push(created.watchSessionId);
  }
  check("the account keeps at most five watch sessions", activeCount() === WATCH_SESSIONS_PER_USER, {
    active: activeCount(),
  });
  const oldest = database.prepare("SELECT revoked_at FROM watch_sessions WHERE watch_session_id = ?").get(ids[0] ?? "");
  check("a sixth watch ends the oldest watch session", oldest?.revoked_at === clock.now, oldest);

  const invalidKey = await pair({ publicKey: `A${"A".repeat(86)}`, privateKey: key.privateKey });
  check(
    "a public key that is not a raw P-256 key is refused",
    invalidKey.code === "invalid_remote_request",
    invalidKey,
  );
  const offCurve = await pair({ publicKey: `B${"A".repeat(86)}`, privateKey: key.privateKey });
  check("a public key that is not on the curve is refused", offCurve.code === "invalid_remote_request", offCurve);
  const wrongUser = await pair(await watchKey(), otherToken, OWNER);
  check("a phone session of another account cannot pair a watch", wrongUser.code === "auth_session_revoked", wrongUser);

  const revokeOther = await result(sessions.revoke(OTHER, second.watchSessionId));
  check("another account cannot revoke the watch session", revokeOther.code === "watch_session_not_found", revokeOther);
  const revoke = await result(sessions.revoke(OWNER, second.watchSessionId));
  check("the account revokes its watch session", revoke.code === null, revoke.code);
  const afterRevoke = await ticket(second.token, key, second.watchSessionId);
  check("a revoked watch session gets no ticket", afterRevoke.code === "watch_session_ended", afterRevoke);
  const again = await result(sessions.revoke(OWNER, second.watchSessionId));
  check("revoking the same watch session again succeeds", again.code === null, again.code);
}

const scenarios = [
  aPairedWatchGetsATicket,
  refusedTicketsGiveNoTicket,
  theParentSessionEndsTheWatch,
  aShortPhoneSessionLimitsTheWatch,
  pairingRulesKeepFiveWatches,
];
for (const scenario of scenarios) {
  try {
    await scenario();
  } catch (error) {
    check(scenario.name, false, { error: error instanceof Error ? error.message : String(error) });
  }
}

await mkdir(OUT, { recursive: true });
const report = { passed: checks.length > 0 && checks.every((entry) => entry.passed), checks };
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const entry of checks) console.log(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!report.passed) process.exitCode = 1;
