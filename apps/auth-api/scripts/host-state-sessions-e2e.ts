import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Effect } from "effect";
import { type Unstable_DevWorker, unstable_dev } from "wrangler";
import type { RemoteControlPlane, RemoteResumeClaims } from "../src/server/remote-control-plane";
import type { ProbeRequest } from "./host-state-object-worker";

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "../../..");
const APP = join(ROOT, "apps", "auth-api");
const PROBE_WORKER = join(APP, "scripts", "host-state-object-worker.ts");
const MIGRATIONS = join(APP, "migrations");
const WRANGLER = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");

type Mode = "off" | "write" | "read";

interface D1Call {
  session: string;
  sql: string;
}

type ListedHost = Effect.Success<ReturnType<RemoteControlPlane["listHosts"]>>[number];

interface ProbeResult {
  ok: boolean;
  code?: string;
  status?: number | null;
  authEpoch?: number;
  machineToken?: string | null;
  generation?: number;
  cached?: boolean;
  pending?: number;
  sessionId?: string;
  expiresAt?: number;
  valid?: boolean[];
  open?: boolean;
  hosts?: ListedHost[];
  rowsRead: number;
  d1: D1Call[];
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function ticketKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "ticket-1" }),
    REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [{ ...publicJwk, kid: "ticket-1" }] }),
    REMOTE_TICKET_KEY_ID: "ticket-1",
  };
}

async function startProbe(input: { out: string; name: string; vars: Record<string, string>; seed: string }) {
  const work = join(input.out, `probe-${input.name}`);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const state = join(work, "state");
  const config = join(work, "wrangler.jsonc");
  await writeFile(
    config,
    JSON.stringify({
      name: `host-state-object-${input.name}`,
      main: PROBE_WORKER,
      compatibility_date: "2026-08-18",
      compatibility_flags: ["nodejs_compat"],
      d1_databases: [
        {
          binding: "DB",
          database_name: "openbot-auth",
          database_id: `host-state-${input.name}`,
          migrations_dir: MIGRATIONS,
        },
      ],
      durable_objects: {
        bindings: [
          { name: "HOST_STATE", class_name: "HostState" },
          { name: "BROKEN_HOST_STATE", class_name: "BrokenHostState" },
        ],
      },
      migrations: [{ tag: "host-state-v1", new_sqlite_classes: ["HostState", "BrokenHostState"] }],
      vars: input.vars,
    }),
  );
  const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
  const wrangler = (args: string[]) => run(WRANGLER, args, { cwd: work, env, maxBuffer: 64 * 1024 * 1024 });
  await wrangler(["d1", "migrations", "apply", "openbot-auth", "--local", "--persist-to", state, "-c", config]);
  const seed = join(work, "seed.sql");
  await writeFile(seed, input.seed);
  await wrangler(["d1", "execute", "openbot-auth", "--local", "--persist-to", state, "-c", config, "--file", seed]);
  return unstable_dev(PROBE_WORKER, {
    config,
    persistTo: state,
    local: true,
    logLevel: "error",
    experimental: { disableExperimentalWarning: true },
  });
}

function caller(worker: Unstable_DevWorker, clock: { now: number }) {
  return async (mode: Mode, request: ProbeRequest, broken = false, failInvalidate = false): Promise<ProbeResult> => {
    const response = await worker.fetch("http://probe.test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ options: { mode, broken, clock: clock.now, failInvalidate }, request }),
    });
    const text = await response.text();
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error(`Probe failed with ${response.status}: ${text.slice(0, 2_000)}`);
    }
    return JSON.parse(text);
  };
}

const OUT = join(ROOT, ".openbot-build", "host-state-sessions-e2e");
const MINUTE = 60_000;
const SIGN_IN_LIMIT_MS = MINUTE;
const FAR_FUTURE = 4_102_444_800_000;
const MODES = ["off", "write", "read"] as const satisfies readonly Mode[];
const MEMBERS = Array.from({ length: 10 }, (_, index) => `m${index}`);
const LIST_HOSTS = Array.from({ length: 5 }, (_, index) => `h-list-${index}`);
const TICKET_HOSTS = { off: "h-ticket-off", read: "h-ticket-read" } as const;
const OWNER = { id: "owner", email: "owner@example.test", name: "Owner" };
const AUTH_USER = { ...OWNER, avatarUrl: null, analyticsEnabled: null, chatColor: null };
const LISTER = "lister";

const steps: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  steps.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

const signInToken = (userId: string) => `signin-${userId}`;
const otherBrowserToken = (userId: string) => `signin-other-${userId}`;
const hostToken = (hostId: string) => `token-${hostId}`;
const revocationHost = (mode: Mode) => `h-rev-${mode}`;
const revocationUser = (mode: Mode) => `r-${mode}`;

function seedSql(start: number, periodEnd: number): string {
  const users = [OWNER.id, LISTER, ...MEMBERS, ...MODES.map(revocationUser)];
  const hosts = [...Object.values(TICKET_HOSTS), ...LIST_HOSTS, ...MODES.map(revocationHost), "h-retry", "h-broken"];
  const members = new Map<string, string[]>([
    ...Object.values(TICKET_HOSTS).map((hostId): [string, string[]] => [hostId, MEMBERS]),
    ...LIST_HOSTS.map((hostId): [string, string[]] => [hostId, [LISTER]]),
    ...MODES.map((mode): [string, string[]] => [revocationHost(mode), ["m0", "m1", revocationUser(mode)]]),
    ["h-retry", ["m0"]],
    ["h-broken", MEMBERS],
  ]);
  const rows = users.flatMap((userId) => [
    `INSERT INTO users(id, identity_key, email, name, created_at, updated_at) VALUES (${quote(userId)}, ${quote(`email:${userId}@example.test`)}, ${quote(`${userId}@example.test`)}, ${quote(userId)}, 1, 1);`,
    `INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at, revoked_at) VALUES (${quote(`auth-${userId}`)}, ${quote(userId)}, ${quote(tokenHash(signInToken(userId)))}, ${FAR_FUTURE}, 1, 1, NULL);`,
    `INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at, revoked_at) VALUES (${quote(`auth-other-${userId}`)}, ${quote(userId)}, ${quote(tokenHash(otherBrowserToken(userId)))}, ${FAR_FUTURE}, 1, 1, NULL);`,
  ]);
  for (const hostId of hosts) {
    rows.push(
      `INSERT INTO remote_hosts(host_id, owner_user_id, name, machine_token_hash, device_public_key, auth_epoch, created_at, updated_at) VALUES (${quote(hostId)}, 'owner', ${quote(hostId)}, ${quote(tokenHash(hostToken(hostId)))}, ${quote(`key-${hostId}`)}, 1, 1, 1);`,
      `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at) VALUES (${quote(`${hostId}:owner`)}, ${quote(hostId)}, 'owner', 'owner', 'active', 1, 1);`,
    );
    for (const userId of members.get(hostId) ?? []) {
      rows.push(
        `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at) VALUES (${quote(`${hostId}:${userId}`)}, ${quote(hostId)}, ${quote(userId)}, 'member', 'active', 1, 1);`,
      );
    }
  }
  LIST_HOSTS.forEach((hostId, index) => {
    rows.push(
      `INSERT INTO server_member_limits(server_id, owner_user_id, member_limit, created_at, updated_at) VALUES (${quote(hostId)}, 'owner', ${4 + index}, 1, 1);`,
      `INSERT INTO billing_subscriptions(stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, amount, status, current_period_end, cancel_at_period_end, updated_at) VALUES (${quote(`sub-plan-${hostId}`)}, 'owner', 'cus-owner', ${quote(hostId)}, 'pro', 'month', 'eur', 900, 'active', ${FAR_FUTURE}, 0, 1);`,
      `INSERT INTO remote_host_key_handovers(handover_id, host_id, issued_at, previous_public_key, public_key, previous_signature, signature, created_at) VALUES (${quote(`handover-${hostId}`)}, ${quote(hostId)}, ${start - MINUTE}, ${quote(`old-key-${hostId}`)}, ${quote(`key-${hostId}`)}, 'old-signature', 'new-signature', 1);`,
    );
  });
  rows.push(
    `INSERT INTO licenses(stripe_subscription_id, user_id, stripe_customer_id, users, currency, status, current_period_end, cancel_at_period_end, updated_at) VALUES ('sub-license-active', 'owner', 'cus-owner', 50, 'eur', 'active', ${FAR_FUTURE}, 0, 1);`,
    `INSERT INTO licenses(stripe_subscription_id, user_id, stripe_customer_id, users, currency, status, current_period_end, cancel_at_period_end, updated_at) VALUES ('sub-license-late', 'owner', 'cus-owner', 2, 'eur', 'past_due', ${periodEnd}, 0, 2);`,
  );
  return rows.join("\n");
}

interface QueryCount {
  calls: number;
  primary: number;
  total: number;
  rowsRead: number;
}

function counter(): QueryCount {
  return { calls: 0, primary: 0, total: 0, rowsRead: 0 };
}

function count(into: QueryCount, result: ProbeResult) {
  into.calls += 1;
  into.total += result.d1.length;
  into.primary += result.d1.filter((call) => call.session !== "first-unconstrained").length;
  into.rowsRead += result.rowsRead;
}

const answer = (result: ProbeResult) => ({
  ok: result.ok,
  code: result.code ?? null,
  authEpoch: result.authEpoch ?? null,
  valid: result.valid ?? null,
  open: result.open ?? null,
  hosts: result.hosts ?? null,
});

const same = (left: ProbeResult, right: ProbeResult) => JSON.stringify(answer(left)) === JSON.stringify(answer(right));

interface RevocationDetail {
  passed: boolean;
  endedTicket: string | undefined;
  endedValid: boolean[] | undefined;
  endedOpen: boolean | undefined;
  removedTicket: string | undefined;
  removedValid: boolean[] | undefined;
  epochBefore: number;
  rotatedTicketEpoch: number | undefined;
  rotatedOld: boolean[] | undefined;
  rotatedNew: boolean[] | undefined;
  signInAtOnce: string;
  signInAfter60s: string | undefined;
  signInValid: boolean[] | undefined;
  signInOpen: boolean | undefined;
}

interface MeasuredModes {
  off: QueryCount;
  read: QueryCount;
}

interface SessionsReport {
  tickets?: MeasuredModes & { sessions: number; ticketsPerMode: number; simulatedMinutes: number };
  hostList?: MeasuredModes & { hosts: number; callsPerMode: number };
  validateBatch?: MeasuredModes & { claims: number; callsPerMode: number };
  revocation?: Partial<Record<Mode, RevocationDetail>>;
}

interface StartedSession {
  userId: string;
  hostId: string;
  sessionId: string;
  expiresAt: number;
}

const clock = { now: Date.now() };
const start = clock.now;
const periodEnd = start + 3 * 60 * MINUTE;
const workers: Unstable_DevWorker[] = [];
const report: SessionsReport = {};

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

try {
  const worker = await startProbe({
    out: OUT,
    name: "sessions",
    vars: await ticketKeys(),
    seed: seedSql(start, periodEnd),
  });
  workers.push(worker);
  const call = caller(worker, clock);

  const startSession = async (mode: Mode, userId: string, hostId: string): Promise<StartedSession> => {
    const result = await call(mode, {
      op: "session-start",
      userId,
      hostId,
      authSessionHash: tokenHash(signInToken(userId)),
    });
    if (!result.ok || !result.sessionId || result.expiresAt === undefined) {
      throw new Error(`Session start failed for ${userId} on ${hostId}: ${result.code}`);
    }
    return { userId, hostId, sessionId: result.sessionId, expiresAt: result.expiresAt };
  };
  const ticket = (
    mode: Mode,
    session: StartedSession,
    callerHash = tokenHash(signInToken(session.userId)),
    broken = false,
  ) => call(mode, { op: "session-ticket", sessionId: session.sessionId, signedInTokenHash: callerHash }, broken);
  const sessionClaims = (session: StartedSession, authEpoch: number): RemoteResumeClaims => ({
    sessionId: session.sessionId,
    hostId: session.hostId,
    userId: session.userId,
    membershipId: `${session.hostId}:${session.userId}`,
    role: "member",
    authEpoch,
    sessionExpiresAt: Math.floor(session.expiresAt / 1_000),
  });
  const hostClaims = (hostId: string, authEpoch: number): RemoteResumeClaims => ({
    sessionId: `host-${hostId}`,
    hostId,
    userId: OWNER.id,
    membershipId: `${hostId}:host`,
    role: "host",
    authEpoch,
    sessionExpiresAt: Math.floor(FAR_FUTURE / 1_000),
  });
  const validate = (mode: Mode, claims: RemoteResumeClaims[], broken = false) =>
    call(mode, { op: "validate-batch", claims }, broken);
  const listHosts = (mode: Mode, broken = false) => call(mode, { op: "list-hosts", userId: LISTER }, broken);

  const ticketSessions = {
    off: await Promise.all(MEMBERS.map((userId) => startSession("off", userId, TICKET_HOSTS.off))),
    read: await Promise.all(MEMBERS.map((userId) => startSession("read", userId, TICKET_HOSTS.read))),
  };
  const ticketCounts = { off: counter(), read: counter() };
  const ticketFailures: unknown[] = [];
  const epochs = new Map<string, number>();
  for (let round = 0; round < 10; round += 1) {
    for (let index = 0; index < MEMBERS.length; index += 1) {
      for (const mode of ["off", "read"] as const) {
        const session = ticketSessions[mode][index];
        if (!session) continue;
        const result = await ticket(mode, session);
        count(ticketCounts[mode], result);
        if (!result.ok) ticketFailures.push({ mode, round, index, code: result.code });
        if (result.authEpoch !== undefined) epochs.set(session.sessionId, result.authEpoch);
      }
      clock.now += 18_000;
    }
  }
  report.tickets = {
    sessions: MEMBERS.length,
    ticketsPerMode: ticketCounts.read.calls,
    simulatedMinutes: (100 * 18_000) / MINUTE,
    ...ticketCounts,
  };
  check(
    "100 session tickets over 30 min on the production ticket route: every ticket is issued, and flag read adds no D1 primary query",
    ticketFailures.length === 0 &&
      ticketCounts.off.calls === 100 &&
      ticketCounts.read.calls === 100 &&
      ticketCounts.read.primary <= ticketCounts.off.primary,
    { ...ticketCounts, failures: ticketFailures },
  );

  const listCounts = { off: counter(), read: counter() };
  const listMismatches: unknown[] = [];
  for (let index = 0; index < 10; index += 1) {
    const off = await listHosts("off");
    const read = await listHosts("read");
    count(listCounts.off, off);
    count(listCounts.read, read);
    if (!off.ok || off.hosts?.length !== LIST_HOSTS.length || !same(off, read)) {
      listMismatches.push({ index, off: answer(off), read: answer(read) });
    }
    clock.now += 30_000;
  }
  report.hostList = { hosts: LIST_HOSTS.length, callsPerMode: listCounts.read.calls, ...listCounts };
  check(
    "host list of 5 hosts, 10 calls: flag read gives the same answer and reads fewer D1 rows than flag off",
    listMismatches.length === 0 && listCounts.read.rowsRead < listCounts.off.rowsRead,
    { ...listCounts, mismatches: listMismatches },
  );

  const batchClaims = [
    ...LIST_HOSTS.map((hostId) => hostClaims(hostId, 1)),
    ...Object.values(TICKET_HOSTS).map((hostId) => hostClaims(hostId, 1)),
    ...[...ticketSessions.off, ...ticketSessions.read].map((session) =>
      sessionClaims(session, epochs.get(session.sessionId) ?? 1),
    ),
  ];
  const batchCounts = { off: counter(), read: counter() };
  const batchMismatches: unknown[] = [];
  for (let index = 0; index < 10; index += 1) {
    const off = await validate("off", batchClaims);
    const read = await validate("read", batchClaims);
    count(batchCounts.off, off);
    count(batchCounts.read, read);
    if (!off.ok || off.valid?.some((valid) => !valid) || !same(off, read)) {
      batchMismatches.push({ index, off: answer(off), read: answer(read) });
    }
    clock.now += 30_000;
  }
  report.validateBatch = { claims: batchClaims.length, callsPerMode: batchCounts.read.calls, ...batchCounts };
  check(
    "validate-batch of 27 claims, 10 calls: flag read gives the same answer with fewer D1 primary queries",
    batchMismatches.length === 0 && batchCounts.read.primary < batchCounts.off.primary,
    { ...batchCounts, mismatches: batchMismatches },
  );

  const revocation: Partial<Record<Mode, RevocationDetail>> = {};
  for (const mode of MODES) {
    const hostId = revocationHost(mode);
    const [ended, removed, signedOut] = await Promise.all(
      ["m0", "m1", revocationUser(mode)].map((userId) => startSession(mode, userId, hostId)),
    );
    if (!ended || !removed || !signedOut) throw new Error(`Session start failed on ${hostId}`);
    const first = await Promise.all([ended, removed, signedOut].map((session) => ticket(mode, session)));
    const firstEpoch = first[0]?.authEpoch ?? 1;
    const before = await validate(mode, [
      ...[ended, removed, signedOut].map((session) => sessionClaims(session, firstEpoch)),
      hostClaims(hostId, firstEpoch),
    ]);

    await call(mode, { op: "end-session", userId: ended.userId, sessionId: ended.sessionId });
    const endedTicket = await ticket(mode, ended);
    const endedValid = await validate(mode, [sessionClaims(ended, firstEpoch)]);
    const endedOpen = await call(mode, { op: "session-open", hostId, sessionId: ended.sessionId });

    const removal = await call(mode, {
      op: "revoke-member",
      hostId,
      actorUserId: OWNER.id,
      membershipId: `${hostId}:${removed.userId}`,
    });
    const removedTicket = await ticket(mode, removed);
    const removedValid = await validate(mode, [sessionClaims(removed, firstEpoch)]);

    const rotationBefore = await ticket(mode, signedOut);
    const epochBefore = rotationBefore.authEpoch ?? 0;
    const rotation = await call(mode, {
      op: "rotate",
      hostId,
      token: hostToken(hostId),
      user: AUTH_USER,
      ownerMembershipId: `${hostId}:owner`,
    });
    const rotatedOld = await validate(mode, [hostClaims(hostId, epochBefore), sessionClaims(signedOut, epochBefore)]);
    const rotatedTicket = await ticket(mode, signedOut);
    const rotatedNew = await validate(mode, [hostClaims(hostId, epochBefore + 1)]);

    const revokedAt = clock.now;
    await call(mode, { op: "revoke-sign-in", tokenHash: tokenHash(signInToken(signedOut.userId)), at: revokedAt });
    const otherCaller = tokenHash(otherBrowserToken(signedOut.userId));
    const signInAtOnce = await ticket(mode, signedOut, otherCaller);
    clock.now = revokedAt + SIGN_IN_LIMIT_MS;
    const signInTicket = await ticket(mode, signedOut, otherCaller);
    const signInValid = await validate(mode, [sessionClaims(signedOut, epochBefore + 1)]);
    const signInOpen = await call(mode, { op: "session-open", hostId, sessionId: signedOut.sessionId });
    clock.now += 1_000;

    const passed =
      first.every((result) => result.ok) &&
      before.valid?.every(Boolean) === true &&
      endedTicket.code === "session_inactive" &&
      endedValid.valid?.[0] === false &&
      endedOpen.open === false &&
      removal.ok &&
      removedTicket.code === "session_inactive" &&
      removedValid.valid?.[0] === false &&
      rotation.ok &&
      rotatedOld.valid?.every((valid) => !valid) === true &&
      rotatedTicket.authEpoch === epochBefore + 1 &&
      rotatedNew.valid?.[0] === true &&
      signInTicket.code === "session_inactive" &&
      signInValid.valid?.[0] === false &&
      signInOpen.open === false;
    revocation[mode] = {
      passed,
      endedTicket: endedTicket.code,
      endedValid: endedValid.valid,
      endedOpen: endedOpen.open,
      removedTicket: removedTicket.code,
      removedValid: removedValid.valid,
      epochBefore,
      rotatedTicketEpoch: rotatedTicket.authEpoch,
      rotatedOld: rotatedOld.valid,
      rotatedNew: rotatedNew.valid,
      signInAtOnce: signInAtOnce.code ?? "ticket issued",
      signInAfter60s: signInTicket.code,
      signInValid: signInValid.valid,
      signInOpen: signInOpen.open,
    };
    check(
      `flag ${mode}: an ended session, a removed member and a rotated host key are refused at once, and a revoked sign-in within 60 s`,
      passed,
      revocation[mode],
    );
  }
  report.revocation = revocation;

  const retrySession = await startSession("read", "m0", "h-retry");
  const retryFilled = await ticket("read", retrySession);
  await call("read", { op: "end-session", userId: "m0", sessionId: retrySession.sessionId }, false, true);
  const retryStale = await ticket("read", retrySession);
  const retryQueued = await call("read", { op: "state", hostId: "h-retry" });
  clock.now += MINUTE;
  const retried = await call("read", { op: "minute-cron" });
  const retryApplied = await call("read", { op: "state", hostId: "h-retry" });
  const retryTicket = await ticket("read", retrySession);
  const retryOpen = await call("read", { op: "session-open", hostId: "h-retry", sessionId: retrySession.sessionId });
  check(
    "flag read: a failed invalidation after a session end is queued, retried by the 1 min cron, and applied",
    retryFilled.ok &&
      retryQueued.pending === 1 &&
      retried.ok &&
      retried.pending === 0 &&
      (retryApplied.generation ?? 0) > (retryQueued.generation ?? 0) &&
      retryTicket.code === "session_inactive" &&
      retryOpen.open === false,
    {
      retryStale: answer(retryStale),
      retryQueued: { generation: retryQueued.generation, pending: retryQueued.pending },
      retried: { ok: retried.ok, pending: retried.pending },
      retryApplied: { generation: retryApplied.generation, pending: retryApplied.pending },
      retryTicket: answer(retryTicket),
      retryOpen: retryOpen.open,
    },
  );

  const brokenSessions = await Promise.all(MEMBERS.map((userId) => startSession("off", userId, "h-broken")));
  const brokenMismatches: unknown[] = [];
  const compareBroken = (name: string, off: ProbeResult, broken: ProbeResult) => {
    if (!same(off, broken)) brokenMismatches.push({ name, off: answer(off), broken: answer(broken) });
  };
  for (const session of brokenSessions) {
    compareBroken(
      `ticket ${session.userId}`,
      await ticket("off", session),
      await ticket("read", session, undefined, true),
    );
    compareBroken(
      `open ${session.userId}`,
      await call("off", { op: "session-open", hostId: "h-broken", sessionId: session.sessionId }),
      await call("read", { op: "session-open", hostId: "h-broken", sessionId: session.sessionId }, true),
    );
  }
  const brokenClaims = [
    hostClaims("h-broken", 1),
    hostClaims("h-broken", 2),
    ...brokenSessions.map((session) => sessionClaims(session, 1)),
    ...brokenSessions.map((session) => sessionClaims(session, 99)),
  ];
  compareBroken("validate-batch", await validate("off", brokenClaims), await validate("read", brokenClaims, true));
  compareBroken("list-hosts", await listHosts("off"), await listHosts("read", true));
  check(
    "flag read with the object down: tickets, validate-batch, session-open and the host list equal flag off",
    brokenMismatches.length === 0,
    {
      compared: brokenSessions.length * 2 + 2,
      mismatches: brokenMismatches,
    },
  );

  clock.now = Math.max(clock.now, periodEnd - MINUTE);
  const beforeEnd = { off: await listHosts("off"), read: await listHosts("read") };
  clock.now = periodEnd + MINUTE;
  const afterEnd = { off: await listHosts("off"), read: await listHosts("read") };
  const limits = (result: ProbeResult) => result.hosts?.map((host) => host.memberLimit) ?? [];
  check(
    "flag read: a license period end inside the 10 min copy changes the host list as flag off does",
    same(beforeEnd.off, beforeEnd.read) &&
      same(afterEnd.off, afterEnd.read) &&
      JSON.stringify(limits(beforeEnd.off)) !== JSON.stringify(limits(afterEnd.off)),
    {
      before: limits(beforeEnd.off),
      beforeRead: limits(beforeEnd.read),
      after: limits(afterEnd.off),
      afterRead: limits(afterEnd.read),
    },
  );

  const licenseBefore = await listHosts("read");
  const licenseChange = await call("read", { op: "license-changed", ownerUserId: OWNER.id, users: 3 });
  const licenseRead = await listHosts("read");
  const licenseOff = await listHosts("off");
  check(
    "flag read: a license change is seen in the host list at once",
    licenseChange.ok &&
      same(licenseOff, licenseRead) &&
      JSON.stringify(limits(licenseBefore)) !== JSON.stringify(limits(licenseRead)),
    { before: limits(licenseBefore), read: limits(licenseRead), off: limits(licenseOff) },
  );
} finally {
  for (const worker of workers) await worker.stop();
}

const passed = steps.length > 0 && steps.every((step) => step.passed);
await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, ...report, steps }, null, 2)}\n`);
for (const step of steps) console.log(`${step.passed ? "PASS" : "FAIL"} ${step.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exitCode = 1;
