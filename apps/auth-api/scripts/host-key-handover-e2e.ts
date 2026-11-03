// Runs the real host key handover of the account server on a migrated SQLite database (#2745). A host
// that both keys signed for moves to the new key. It keeps its machine token and its auth epoch, so
// paired devices stay signed in, and its Mobile Connect links stop. The same request again changes
// nothing. A step from a key that the host no longer has, an earlier step, a bad signature, a wrong
// machine token and another account are refused. The host list and the invitation preview send the
// latest 32 steps, the earliest first.
//
// Run: bun run test:host-key-handover
// It writes .openbot-build/host-key-handover-e2e/report.json and exits non-zero on a failure.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  HOST_KEY_HANDOVER_LIMIT,
  type HostKeyHandover,
  hostKeyHandoverStatement,
} from "@openbot/contracts/host-key-handover";
import { Effect } from "effect";
import { encodeBase64Url } from "../src/server/crypto";
import { RemoteControlPlane } from "../src/server/remote-control-plane";
import type { AuthUser } from "../src/server/types";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "host-key-handover-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const HOST_ID = "host-1";
const OWNER: AuthUser = {
  id: "user-owner",
  email: "owner@example.test",
  name: "Owner",
  avatarUrl: null,
  analyticsEnabled: null,
};
const OTHER: AuthUser = {
  id: "user-other",
  email: "other@example.test",
  name: "Other",
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

const ticketKeys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicJwk = await crypto.subtle.exportKey("jwk", ticketKeys.publicKey);
const privateJwk = await crypto.subtle.exportKey("jwk", ticketKeys.privateKey);

interface HostKey {
  pem: string;
  privateKey: CryptoKey;
}

/** An Ed25519 key in the PEM form that the host sends: 64 characters for each line. */
async function hostKey(): Promise<HostKey> {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const base64 = Buffer.from(spki).toString("base64");
  const lines = base64.match(/.{1,64}/gu) ?? [base64];
  return {
    pem: `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`,
    privateKey: pair.privateKey,
  };
}

async function sign(key: CryptoKey, message: Uint8Array<ArrayBuffer>) {
  return encodeBase64Url(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, message)));
}

/** A step that `previousSigner` and `nextSigner` sign. By default they are the two keys of the step. */
async function handover(
  previous: HostKey,
  next: HostKey,
  issuedAt: number,
  signers: { previousSigner?: HostKey; nextSigner?: HostKey; hostId?: string } = {},
): Promise<HostKeyHandover> {
  const fields = { hostId: signers.hostId ?? HOST_ID, issuedAt, previousPublicKey: previous.pem, publicKey: next.pem };
  const statement = new TextEncoder().encode(hostKeyHandoverStatement(fields));
  return {
    ...fields,
    previousSignature: await sign((signers.previousSigner ?? previous).privateKey, statement),
    signature: await sign((signers.nextSigner ?? next).privateKey, statement),
  };
}

/** A migrated database with a registered host, an open Mobile Connect link, and the real control plane. */
async function setup() {
  const database = await migratedDatabase();
  const now = Date.now();
  const addUser = database.prepare(
    "INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
  );
  for (const user of [OWNER, OTHER]) addUser.run(user.id, `email:${user.email}`, user.email, user.name, now, now);
  const plane = new RemoteControlPlane(
    {
      DB: sqliteD1(database),
      REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "ticket-1" }),
      REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [{ ...publicJwk, kid: "ticket-1" }] }),
      REMOTE_TICKET_KEY_ID: "ticket-1",
    },
    { now: () => now, schedule: () => undefined },
  );
  const first = await hostKey();
  const registered = await Effect.runPromise(
    plane.registerHost(OWNER, {
      hostId: HOST_ID,
      name: "Studio",
      ownerMembershipId: "membership-owner",
      devicePublicKey: first.pem,
    }),
  );
  if (!registered.machineToken) throw new Error("The host did not get a machine token.");
  database.exec(`
    INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
    VALUES ('desktop', '${OWNER.id}', 'desktop-hash', ${now + 60_000}, ${now}, ${now});
    INSERT INTO mobile_connect_links(link_hash, user_id, desktop_session_id, host_id, host_fingerprint, created_at)
    VALUES ('link-1', '${OWNER.id}', 'desktop', '${HOST_ID}', 'fingerprint', ${now});
  `);
  const host = () => {
    const row = database
      .prepare("SELECT device_public_key, machine_token_hash, auth_epoch FROM remote_hosts WHERE host_id = ?")
      .get(HOST_ID);
    return { key: row?.device_public_key, tokenHash: row?.machine_token_hash, epoch: Number(row?.auth_epoch) };
  };
  const count = (sql: string) => Number(database.prepare(sql).get()?.count);
  const storedSteps = () => count("SELECT COUNT(*) AS count FROM remote_host_key_handovers");
  const openLinks = () => count("SELECT COUNT(*) AS count FROM mobile_connect_links WHERE revoked_at IS NULL");
  const events = () => count("SELECT COUNT(*) AS count FROM remote_auth_events");
  const hand = (step: HostKeyHandover, user = OWNER, machineToken = registered.machineToken ?? "") =>
    result(plane.handOverHostKey(user, { hostId: HOST_ID, machineToken, handover: step }));
  return { plane, first, now, host, storedSteps, openLinks, events, hand, machineToken: registered.machineToken };
}

/** The error code of an operation, or null when it succeeds. */
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

async function theHostMovesToTheNewKey() {
  const { plane, first, now, host, storedSteps, openLinks, events, hand, machineToken } = await setup();
  const before = host();
  const eventsBefore = events();
  const next = await hostKey();
  const step = await handover(first, next, now);
  const moved = await hand(step);
  const after = host();
  check("a handover that both keys signed succeeds", moved.code === null, moved.code);
  check("the answer has the stored step", JSON.stringify(moved.value?.keyHandovers) === JSON.stringify([step]));
  check("the host has the new key", after.key === next.pem);
  check("the host keeps its machine token", after.tokenHash === before.tokenHash);
  check("the host keeps its auth epoch, so paired devices stay signed in", after.epoch === before.epoch, {
    before: before.epoch,
    after: after.epoch,
  });
  check("a handover queues no auth event", events() === eventsBefore, { before: eventsBefore, after: events() });
  check("the Mobile Connect links of the host stop", openLinks() === 0, { open: openLinks() });

  const again = await hand(step);
  check("the same handover again succeeds", again.code === null, again.code);
  check("the same handover again stores nothing", storedSteps() === 1, { stored: storedSteps() });
  check("the same handover again keeps the new key", host().key === next.pem);

  const hosts = await Effect.runPromise(plane.listHosts(OWNER.id));
  check(
    "the host list sends the step",
    JSON.stringify(hosts.find((entry) => entry.hostId === HOST_ID)?.keyHandovers) === JSON.stringify([step]),
  );
  const invite = await Effect.runPromise(plane.createInvite(OWNER, { hostId: HOST_ID, role: "member" }));
  const preview = await Effect.runPromise(plane.previewInvite(invite.token));
  check("the invitation preview sends the step", JSON.stringify(preview.keyHandovers) === JSON.stringify([step]));
  check("the invitation preview has the new key", preview.devicePublicKey === next.pem);

  // The host publishes itself again on its next start, now with the new key.
  const published = await result(
    plane.registerHost(OWNER, {
      hostId: HOST_ID,
      name: "Studio",
      ownerMembershipId: "membership-owner",
      devicePublicKey: next.pem,
      rotateCredential: false,
      machineToken,
    }),
  );
  check("the next registration with the new key keeps the machine token", published.value?.machineToken === null, {
    code: published.code,
  });
  check("the next registration keeps the auth epoch", host().epoch === before.epoch, { after: host().epoch });
}

async function refusedHandoversChangeNothing() {
  const { first, now, host, storedSteps, hand } = await setup();
  const next = await hostKey();
  const stranger = await hostKey();
  const before = host();
  const badPrevious = await hand(await handover(first, next, now, { previousSigner: stranger }));
  check("a step that the previous key did not sign fails", badPrevious.code === "invalid_remote_request", badPrevious);
  const badNext = await hand(await handover(first, next, now, { nextSigner: stranger }));
  check("a step that the new key did not sign fails", badNext.code === "invalid_remote_request", badNext);
  const sameKey = await hand(await handover(first, first, now));
  check("a step to the same key fails", sameKey.code === "invalid_remote_request", sameKey);
  const otherHost = await hand(await handover(first, next, now, { hostId: "host-2" }));
  check("a step for another host fails", otherHost.code === "invalid_remote_request", otherHost);
  const fromStranger = await hand(await handover(stranger, next, now));
  check(
    "a step from a key that the host does not have fails with a conflict",
    fromStranger.code === "host_key_handover_conflict" && fromStranger.status === 409,
    fromStranger,
  );
  const step = await handover(first, next, now);
  const wrongToken = await hand(step, OWNER, "wrong-token");
  check("a wrong machine token fails", wrongToken.code === "host_unauthorized", wrongToken);
  const otherAccount = await hand(step, OTHER);
  check("another account fails", otherAccount.code === "host_owner_mismatch", otherAccount);
  check("refused steps keep the host key", host().key === before.key);
  check("refused steps store nothing", storedSteps() === 0, { stored: storedSteps() });
}

async function aStaleHandoverConflicts() {
  const { first, now, host, hand } = await setup();
  const second = await hostKey();
  const third = await hostKey();
  await hand(await handover(first, second, now));
  const stale = await hand(await handover(first, third, now + 1));
  check("a step from the replaced key fails with a conflict", stale.code === "host_key_handover_conflict", stale);
  const earlier = await hand(await handover(second, third, now - 1));
  check(
    "a step older than the stored step fails with a conflict",
    earlier.code === "host_key_handover_conflict",
    earlier,
  );
  const unknownAtNewKey = await hand(await handover(third, second, now + 2, { previousSigner: third }));
  check(
    "a step to the current key that is not stored fails with a conflict",
    unknownAtNewKey.code === "host_key_handover_conflict",
    unknownAtNewKey,
  );
  check("the conflicts keep the current key", host().key === second.pem);
}

async function onlyTheLatestStepsStay() {
  const { plane, first, now, storedSteps, hand } = await setup();
  let current = first;
  const steps: HostKeyHandover[] = [];
  for (let index = 0; index < HOST_KEY_HANDOVER_LIMIT + 3; index += 1) {
    const next = await hostKey();
    const step = await handover(current, next, now + index);
    const moved = await hand(step);
    if (moved.code) throw new Error(`Step ${index} failed with ${moved.code}.`);
    steps.push(step);
    current = next;
  }
  check("the account service keeps the latest 32 steps", storedSteps() === HOST_KEY_HANDOVER_LIMIT, {
    stored: storedSteps(),
  });
  const hosts = await Effect.runPromise(plane.listHosts(OWNER.id));
  const sent = hosts.find((entry) => entry.hostId === HOST_ID)?.keyHandovers ?? [];
  check(
    "the host list sends the latest 32 steps, the earliest first",
    JSON.stringify(sent) === JSON.stringify(steps.slice(-HOST_KEY_HANDOVER_LIMIT)),
    { sent: sent.map((entry) => entry.issuedAt) },
  );
}

async function aRegistrationWithAnotherKeyDropsTheSteps() {
  const { plane, first, now, host, storedSteps, hand } = await setup();
  await hand(await handover(first, await hostKey(), now));
  // The host lost its machine token, so it dropped its pending handover and registers its old key.
  const registered = await result(
    plane.registerHost(OWNER, {
      hostId: HOST_ID,
      name: "Studio",
      ownerMembershipId: "membership-owner",
      devicePublicKey: first.pem,
    }),
  );
  check("a registration with another key succeeds", registered.code === null, registered.code);
  check("a registration with another key drops the steps", storedSteps() === 0, { stored: storedSteps() });
  const third = await hostKey();
  const step = await handover(first, third, now - 1);
  const moved = await hand(step, OWNER, registered.value?.machineToken ?? "");
  check("the next handover after the registration succeeds", moved.code === null, moved.code);
  const hosts = await Effect.runPromise(plane.listHosts(OWNER.id));
  check(
    "the host list sends only the step from the registered key",
    JSON.stringify(hosts.find((entry) => entry.hostId === HOST_ID)?.keyHandovers) === JSON.stringify([step]),
  );
  check("the host has the key of the last step", host().key === third.pem);

  const again = await result(
    plane.registerHost(OWNER, {
      hostId: HOST_ID,
      name: "Studio",
      ownerMembershipId: "membership-owner",
      devicePublicKey: third.pem,
    }),
  );
  check("a registration with the same key keeps the steps", again.code === null && storedSteps() === 1, {
    code: again.code,
    stored: storedSteps(),
  });
}

async function aHostThatLeavesDropsItsSteps() {
  const { plane, first, now, storedSteps, hand } = await setup();
  await hand(await handover(first, await hostKey(), now));
  await Effect.runPromise(plane.deleteHost(OWNER.id, HOST_ID, true));
  check("a host that leaves the account and keeps its identity drops its steps", storedSteps() === 0, {
    stored: storedSteps(),
  });
}

const scenarios = [
  theHostMovesToTheNewKey,
  refusedHandoversChangeNothing,
  aStaleHandoverConflicts,
  onlyTheLatestStepsStay,
  aRegistrationWithAnotherKeyDropsTheSteps,
  aHostThatLeavesDropsItsSteps,
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
