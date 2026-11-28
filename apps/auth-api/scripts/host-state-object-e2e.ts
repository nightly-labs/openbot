import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { type Unstable_DevWorker, unstable_dev } from "wrangler";
import type { ProbeRequest } from "./host-state-object-worker";

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "../../..");
const APP = join(ROOT, "apps", "auth-api");
const OUT = join(ROOT, ".openbot-build", "host-state-object-e2e");
const MIGRATIONS = join(APP, "migrations");
const WRANGLER = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
const BASELINE_REF = process.env.HOST_STATE_BASELINE_REF ?? "origin/main";
const RECHECK_MS = 60_000;

interface D1Call {
  session: string;
  sql: string;
}

interface ProbeResult {
  ok: boolean;
  code?: string;
  status?: number | null;
  authEpoch?: number;
  machineToken?: string | null;
  generation?: number;
  cached?: boolean;
  d1: D1Call[];
}

type Mode = "off" | "write" | "read";

interface ProbeReport {
  baselineRef: string;
  baselineSha: string;
  burst?: { requests: number; baselineQueries: number; readQueries: number; readQueriesAfterFirst: number };
  d1?: {
    sequence: typeof SEQUENCE;
    baselineQueries: number;
    offQueries: number;
    writeQueries: number;
    readQueries: number;
    brokenReadQueries: number;
  };
}

const steps: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  steps.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

const OWNER = { id: "owner", email: "owner@example.test", name: "Owner" };
const MEMBER = { id: "member", email: "member@example.test", name: "Member" };
const AUTH_USER = { ...OWNER, avatarUrl: null, analyticsEnabled: null, chatColor: null };

function hostToken(hostId: string): string {
  return `token-${hostId}`;
}

function seedSql(hostIds: readonly string[]): string {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const users = [OWNER, MEMBER].map(
    (user) =>
      `INSERT INTO users(id, identity_key, email, name, created_at, updated_at) VALUES (${quote(user.id)}, ${quote(`email:${user.email}`)}, ${quote(user.email)}, ${quote(user.name)}, 1, 1);`,
  );
  const hosts = hostIds.flatMap((hostId) => [
    `INSERT INTO remote_hosts(host_id, owner_user_id, name, machine_token_hash, auth_epoch, created_at, updated_at) VALUES (${quote(hostId)}, 'owner', 'Probe host', ${quote(tokenHash(hostToken(hostId)))}, 1, 1, 1);`,
    `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at) VALUES (${quote(`${hostId}:owner`)}, ${quote(hostId)}, 'owner', 'owner', 'active', 1, 1);`,
    `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at) VALUES (${quote(`${hostId}:member`)}, ${quote(hostId)}, 'member', 'member', 'active', 1, 1);`,
  ]);
  return [...users, ...hosts].join("\n");
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

async function baselineEntry(): Promise<{ entry: string; sha: string }> {
  const sha = (await run("git", ["rev-parse", BASELINE_REF], { cwd: ROOT })).stdout.trim();
  const tree = join(OUT, "baseline");
  await rm(tree, { recursive: true, force: true });
  await mkdir(tree, { recursive: true });
  const archive = join(OUT, "baseline.tar");
  await run("git", ["archive", "--output", archive, sha, "apps/auth-api/src"], { cwd: ROOT });
  await run("tar", ["-xf", archive, "-C", tree]);
  await rm(archive, { force: true });
  const app = join(tree, "apps", "auth-api");
  await mkdir(join(app, "scripts"), { recursive: true });
  await copyFile(
    join(APP, "scripts", "host-state-object-worker.ts"),
    join(app, "scripts", "host-state-object-worker.ts"),
  );
  await copyFile(
    join(APP, "src", "server", "host-state-object.ts"),
    join(app, "src", "server", "host-state-object.ts"),
  );
  return { entry: join(app, "scripts", "host-state-object-worker.ts"), sha };
}

async function startProbe(name: string, entry: string, vars: Record<string, string>, hostIds: readonly string[]) {
  const work = join(OUT, `probe-${name}`);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const state = join(work, "state");
  const config = join(work, "wrangler.jsonc");
  await writeFile(
    config,
    JSON.stringify({
      name: `host-state-object-${name}`,
      main: entry,
      compatibility_date: "2026-08-18",
      compatibility_flags: ["nodejs_compat"],
      d1_databases: [
        { binding: "DB", database_name: "openbot-auth", database_id: `host-state-${name}`, migrations_dir: MIGRATIONS },
      ],
      durable_objects: {
        bindings: [
          { name: "HOST_STATE", class_name: "HostState" },
          { name: "BROKEN_HOST_STATE", class_name: "BrokenHostState" },
        ],
      },
      migrations: [{ tag: "host-state-v1", new_sqlite_classes: ["HostState", "BrokenHostState"] }],
      vars,
    }),
  );
  const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
  const wrangler = (args: string[]) => run(WRANGLER, args, { cwd: work, env, maxBuffer: 64 * 1024 * 1024 });
  await wrangler(["d1", "migrations", "apply", "openbot-auth", "--local", "--persist-to", state, "-c", config]);
  const seed = join(work, "seed.sql");
  await writeFile(seed, seedSql(hostIds));
  await wrangler(["d1", "execute", "openbot-auth", "--local", "--persist-to", state, "-c", config, "--file", seed]);
  return unstable_dev(entry, {
    config,
    persistTo: state,
    local: true,
    logLevel: "error",
    experimental: { disableExperimentalWarning: true },
  });
}

function caller(worker: Unstable_DevWorker, clock: { now: number }) {
  return async (mode: Mode, request: ProbeRequest, broken = false): Promise<ProbeResult> => {
    const response = await worker.fetch("http://probe.test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ options: { mode, broken, clock: clock.now }, request }),
    });
    const text = await response.text();
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error(`Probe failed with ${response.status}: ${text.slice(0, 2_000)}`);
    }
    return JSON.parse(text);
  };
}

const hostReads = (result: ProbeResult) => result.d1.filter((call) => call.sql.includes("FROM remote_hosts"));
const summary = (result: ProbeResult) => ({
  ok: result.ok,
  code: result.code,
  authEpoch: result.authEpoch,
  d1: result.d1.length,
  hostReads: hostReads(result).map((call) => call.session),
});

const SEQUENCE = [
  { op: "ticket", correct: true },
  { op: "ticket", correct: true },
  { op: "ticket", correct: true },
  { op: "homes", correct: true },
  { op: "homes", correct: true },
  { op: "ticket", correct: false },
  { op: "homes", correct: false },
] as const;

async function hostAuthSequence(call: ReturnType<typeof caller>, mode: Mode, hostId: string, broken = false) {
  const results: ProbeResult[] = [];
  for (const item of SEQUENCE) {
    results.push(
      await call(mode, { op: item.op, hostId, token: item.correct ? hostToken(hostId) : "wrong-token" }, broken),
    );
  }
  return results;
}

const sameQueries = (left: ProbeResult[], right: ProbeResult[]) =>
  JSON.stringify(left.map((result) => [result.ok, result.code ?? null, result.d1])) ===
  JSON.stringify(right.map((result) => [result.ok, result.code ?? null, result.d1]));

const totalQueries = (results: ProbeResult[]) => results.reduce((total, result) => total + result.d1.length, 0);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const vars = await ticketKeys();
const clock = { now: Date.now() };
const baseline = await baselineEntry();
const hostIds = ["h-off", "h-write", "h-read", "h-epoch", "h-broken", "h-burst"] as const;
const workers: Unstable_DevWorker[] = [];
const report: ProbeReport = { baselineRef: BASELINE_REF, baselineSha: baseline.sha };

try {
  const main = await startProbe("baseline", baseline.entry, vars, hostIds);
  workers.push(main);
  const current = await startProbe("current", join(APP, "scripts", "host-state-object-worker.ts"), vars, hostIds);
  workers.push(current);
  const callMain = caller(main, clock);
  const callCurrent = caller(current, clock);

  const mainOff = await hostAuthSequence(callMain, "off", "h-off");
  const currentOff = await hostAuthSequence(callCurrent, "off", "h-off");
  check("flag off: the same D1 queries as the baseline", sameQueries(mainOff, currentOff), {
    baseline: mainOff.map(summary),
    current: currentOff.map(summary),
  });
  const offState = await callCurrent("off", { op: "state", hostId: "h-off" });
  check("flag off: no host state object is written", offState.ok && offState.generation === 0 && !offState.cached, {
    offState,
  });

  const currentWrite = await hostAuthSequence(callCurrent, "write", "h-write");
  const mainWrite = await hostAuthSequence(callMain, "off", "h-write");
  check(
    "flag write: host authentication makes the same D1 queries as the baseline",
    sameQueries(mainWrite, currentWrite),
    {
      current: currentWrite.map(summary),
    },
  );

  const burstBaseline: ProbeResult[] = [];
  const burstRead: ProbeResult[] = [];
  for (let index = 0; index < 20; index += 1) {
    burstBaseline.push(
      await callMain("off", { op: index % 2 ? "homes" : "ticket", hostId: "h-burst", token: hostToken("h-burst") }),
    );
    burstRead.push(
      await callCurrent("read", { op: index % 2 ? "homes" : "ticket", hostId: "h-burst", token: hostToken("h-burst") }),
    );
  }
  report.burst = {
    requests: burstRead.length,
    baselineQueries: totalQueries(burstBaseline),
    readQueries: totalQueries(burstRead),
    readQueriesAfterFirst: totalQueries(burstRead.slice(1)),
  };
  check(
    "flag read: 0 D1 queries for host authentication after the first request",
    burstRead.every((result) => result.ok) && burstRead[0]?.d1.length === 1 && totalQueries(burstRead.slice(1)) === 0,
    report.burst,
  );

  const read = await hostAuthSequence(callCurrent, "read", "h-read");
  check(
    "flag read: a wrong token is still refused with a fresh entry",
    read[5]?.code === "host_unauthorized" && read[6]?.code === "host_unauthorized",
    {
      read: read.map(summary),
    },
  );

  clock.now += RECHECK_MS + 1_000;
  const expired = await callCurrent("read", { op: "ticket", hostId: "h-read", token: hostToken("h-read") });
  const refreshed = await callCurrent("read", { op: "ticket", hostId: "h-read", token: hostToken("h-read") });
  check(
    "flag read: an entry older than 60 s is checked again on the D1 primary",
    expired.ok &&
      hostReads(expired)
        .map((call) => call.session)
        .join() === "primary" &&
      refreshed.d1.length === 0,
    { expired: summary(expired), refreshed: summary(refreshed) },
  );

  const beforeRotation = await callCurrent("read", { op: "ticket", hostId: "h-read", token: hostToken("h-read") });
  const rotation = await callCurrent("read", {
    op: "rotate",
    hostId: "h-read",
    token: hostToken("h-read"),
    user: AUTH_USER,
    ownerMembershipId: "h-read:owner",
  });
  const oldToken = await callCurrent("read", { op: "ticket", hostId: "h-read", token: hostToken("h-read") });
  const newToken = await callCurrent("read", { op: "ticket", hostId: "h-read", token: rotation.machineToken ?? "" });
  const newTokenAgain = await callCurrent("read", {
    op: "ticket",
    hostId: "h-read",
    token: rotation.machineToken ?? "",
  });
  check(
    "flag read: a key rotation is seen at once",
    rotation.ok &&
      typeof rotation.machineToken === "string" &&
      oldToken.code === "host_unauthorized" &&
      newToken.ok &&
      newToken.authEpoch === (beforeRotation.authEpoch ?? 0) + 1 &&
      newTokenAgain.d1.length === 0,
    {
      beforeRotation: summary(beforeRotation),
      rotation: { ok: rotation.ok, code: rotation.code, authEpoch: rotation.authEpoch },
      oldToken: summary(oldToken),
      newToken: summary(newToken),
      newTokenAgain: summary(newTokenAgain),
    },
  );

  const epochToken = hostToken("h-epoch");
  const beforeEpoch = await callCurrent("read", { op: "ticket", hostId: "h-epoch", token: epochToken });
  const cachedEpoch = await callCurrent("read", { op: "ticket", hostId: "h-epoch", token: epochToken });
  const removal = await callCurrent("read", {
    op: "revoke-member",
    hostId: "h-epoch",
    actorUserId: OWNER.id,
    membershipId: "h-epoch:member",
  });
  const afterEpoch = await callCurrent("read", { op: "ticket", hostId: "h-epoch", token: epochToken });
  const revoke = await callCurrent("read", {
    op: "revoke-host",
    hostId: "h-epoch",
    token: epochToken,
    user: AUTH_USER,
  });
  const afterRevoke = await callCurrent("read", { op: "ticket", hostId: "h-epoch", token: epochToken });
  check(
    "flag read: an epoch bump from a member removal is seen at once",
    cachedEpoch.d1.length === 0 && removal.ok && afterEpoch.authEpoch === (beforeEpoch.authEpoch ?? 0) + 1,
    { beforeEpoch: summary(beforeEpoch), cachedEpoch: summary(cachedEpoch), removal, afterEpoch: summary(afterEpoch) },
  );
  check(
    "flag read: a revoked host credential is refused at once",
    revoke.ok && afterRevoke.code === "host_unauthorized",
    { revoke: { ok: revoke.ok, code: revoke.code }, afterRevoke: summary(afterRevoke) },
  );

  const brokenRead = await hostAuthSequence(callCurrent, "read", "h-broken", true);
  const brokenBaseline = await hostAuthSequence(callMain, "off", "h-broken");
  check(
    "flag read: an object failure falls back to D1 with the baseline queries",
    sameQueries(brokenBaseline, brokenRead),
    { brokenRead: brokenRead.map(summary) },
  );
  const brokenRotation = await callCurrent(
    "read",
    {
      op: "rotate",
      hostId: "h-broken",
      token: hostToken("h-broken"),
      user: AUTH_USER,
      ownerMembershipId: "h-broken:owner",
    },
    true,
  );
  const brokenAfter = await callCurrent(
    "read",
    { op: "ticket", hostId: "h-broken", token: brokenRotation.machineToken ?? "" },
    true,
  );
  check("flag read: a key rotation succeeds while the object fails", brokenRotation.ok && brokenAfter.ok, {
    brokenRotation: { ok: brokenRotation.ok, code: brokenRotation.code },
    brokenAfter: summary(brokenAfter),
  });

  report.d1 = {
    sequence: SEQUENCE,
    baselineQueries: totalQueries(mainOff),
    offQueries: totalQueries(currentOff),
    writeQueries: totalQueries(currentWrite),
    readQueries: totalQueries(read),
    brokenReadQueries: totalQueries(brokenRead),
  };
} finally {
  for (const worker of workers) await worker.stop();
}

const passed = steps.every((step) => step.passed);
await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, ...report, steps }, null, 2)}\n`);
for (const step of steps) console.log(`${step.passed ? "PASS" : "FAIL"} ${step.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exitCode = 1;
