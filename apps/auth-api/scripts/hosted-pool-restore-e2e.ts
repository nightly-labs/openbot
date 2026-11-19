import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result } from "effect";
import {
  ARCHIVE_REGION,
  B2_BUCKET,
  newArchiveKey,
  presign,
  wrapArchiveKey,
} from "../../../scripts/hosting/pool-archive";
import { BillingService } from "../src/server/billing-service";
import { randomToken, sha256 } from "../src/server/crypto";
import {
  ARCHIVE_DOWNLOAD_SECONDS,
  archiveRestore,
  hostedArchiveKeys,
  presignArchiveDownload,
  unwrapArchiveKey,
} from "../src/server/hosted-archive-restore";
import {
  HostedServerService,
  OPERATOR_HOST_DATA_KEPT_MS,
  POOL_RESTORE_VERSION,
} from "../src/server/hosted-server-service";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "hosted-pool-restore-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const ALERT_URL = "https://alerts.example/webhook";
const OWNER = {
  id: "owner",
  email: "owner@example.test",
  name: null,
  avatarUrl: null,
  analyticsEnabled: null,
  chatColor: null,
};
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WRAP_SECRET = randomBytes(32);
const B2_WORKER = { id: "003worker-key-id", secret: "worker-application-key" };

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  return database;
}

async function failure(call: Effect.Effect<unknown, unknown>) {
  const result = await Effect.runPromise(Effect.result(call));
  if (Result.isSuccess(result)) return null;
  const error = result.failure;
  return isDynamicRecord(error) ? { status: error.status, code: error.code, reason: error.reason } : { status: null };
}

function storedArchive(serverId: string, createdAt: number) {
  const key = newArchiveKey();
  const objectKey = `${ARCHIVE_REGION}/${serverId}/${String(createdAt).padStart(13, "0")}.tar.age`;
  return {
    identity: key.identity,
    archive: {
      server_id: serverId,
      object_key: objectKey,
      region: ARCHIVE_REGION,
      bucket: B2_BUCKET,
      version_id: `4_z${serverId.replaceAll("-", "")}_v1`,
      size_bytes: 123_456,
      sha256: randomBytes(32).toString("hex"),
      wrapped_key: wrapArchiveKey(WRAP_SECRET, key.identity, serverId, objectKey),
    },
  };
}

async function workerOpensTheNodeArchive() {
  const { identity, archive } = storedArchive(randomUUID(), Date.UTC(2026, 10, 19, 9));
  const keys = hostedArchiveKeys({
    HOSTED_ARCHIVE_KEY_SECRET: WRAP_SECRET.toString("base64"),
    B2_WORKER_KEY_ID_EU: B2_WORKER.id,
    B2_WORKER_APPLICATION_KEY_EU: B2_WORKER.secret,
  });
  const unwrapped = keys ? await Effect.runPromise(unwrapArchiveKey(keys.wrapSecret, archive)) : null;
  check(
    "WebCrypto in the Worker unwraps the age key that the Node sync wrapped",
    unwrapped === identity && /^AGE-SECRET-KEY-1[0-9A-Z]{58}$/u.test(identity),
  );
  const otherServer = keys
    ? await failure(unwrapArchiveKey(keys.wrapSecret, { ...archive, server_id: randomUUID() }))
    : null;
  const otherObject = keys
    ? await failure(unwrapArchiveKey(keys.wrapSecret, { ...archive, object_key: `${archive.object_key}x` }))
    : null;
  const otherSecret = await failure(unwrapArchiveKey(new Uint8Array(randomBytes(32)), archive));
  check(
    "the wrapped key does not open for another server, another object or another secret",
    otherServer?.reason === "wrapped_key_invalid" &&
      otherObject?.reason === "wrapped_key_invalid" &&
      otherSecret?.reason === "wrapped_key_invalid",
    { otherServer, otherObject, otherSecret },
  );
  check(
    "a bad or short archive secret, or a missing B2 key, gives no archive keys and no exception",
    hostedArchiveKeys({
      HOSTED_ARCHIVE_KEY_SECRET: "not base64 !",
      B2_WORKER_KEY_ID_EU: "a",
      B2_WORKER_APPLICATION_KEY_EU: "b",
    }) === null &&
      hostedArchiveKeys({
        HOSTED_ARCHIVE_KEY_SECRET: randomBytes(16).toString("base64"),
        B2_WORKER_KEY_ID_EU: "a",
        B2_WORKER_APPLICATION_KEY_EU: "b",
      }) === null &&
      hostedArchiveKeys({ HOSTED_ARCHIVE_KEY_SECRET: WRAP_SECRET.toString("base64") }) === null,
  );

  let worker = "";
  let node = "";
  for (let attempt = 0; attempt < 3 && (worker === "" || worker !== node); attempt += 1) {
    worker = await Effect.runPromise(
      presignArchiveDownload({ keyId: B2_WORKER.id, applicationKey: B2_WORKER.secret }, archive, Date.now()),
    );
    node = presign(B2_WORKER, "GET", archive.object_key, { versionId: archive.version_id }, ARCHIVE_DOWNLOAD_SECONDS);
  }
  const url = new URL(worker);
  check(
    "the Worker download URL is the same SigV4 URL that the Node B2 client signs, for one version, for one hour",
    worker === node &&
      url.host === "s3.eu-central-003.backblazeb2.com" &&
      url.pathname === `/${B2_BUCKET}/${archive.object_key}` &&
      url.searchParams.get("versionId") === archive.version_id &&
      url.searchParams.get("X-Amz-Expires") === "3600" &&
      /^[0-9a-f]{64}$/u.test(url.searchParams.get("X-Amz-Signature") ?? ""),
    { worker, node },
  );
  const unknownRegion = await failure(archiveRestore(keys, { ...archive, region: "us" }, Date.now()));
  const notConfigured = await failure(archiveRestore(null, archive, Date.now()));
  check(
    "an archive in an unknown region, or a Worker with no archive keys, gives no restore",
    unknownRegion?.reason === "unknown_region" && notConfigured?.reason === "not_configured",
    { unknownRegion, notConfigured },
  );
}

const stripeCallsOfAllWorlds: string[][] = [];

function world(options: { archiveKeys?: boolean } = {}) {
  const database = migratedDatabase();
  const t0 = Date.UTC(2026, 10, 19, 12);
  const clock = { now: t0 };
  database
    .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
    .run(OWNER.id, `email:${OWNER.email}`, OWNER.email);
  const alerts: string[] = [];
  const sandboxes: string[] = [];
  const boatFetch = async (input: string, init: RequestInit) => {
    if (input === ALERT_URL) {
      alerts.push(String(JSON.parse(String(init.body)).content));
      return new Response(null, { status: 204 });
    }
    const path = new URL(input).pathname.replace("/api/v1", "");
    if ((init.method ?? "GET") === "POST" && path === "/sandboxes") {
      const body = JSON.parse(String(init.body));
      sandboxes.push(String(body.env.OPENBOT_HOSTED_HOST_ID));
      return Response.json({ ok: true, sandbox: { id: `bx_${sandboxes.length}`, state: "provisioning" } });
    }
    return Response.json({ ok: true, type: "command.finished", exitCode: 0, stdout: "", stderr: "" });
  };
  const stripeCalls: string[] = [];
  stripeCallsOfAllWorlds.push(stripeCalls);
  const billing = new BillingService({
    database: sqliteD1(database),
    secretKey: "sk_test_none",
    webhookSecret: null,
    fetch: async (input) => {
      stripeCalls.push(String(input));
      return Response.json({ error: { type: "api_error" } }, { status: 500 });
    },
    now: () => clock.now,
  });
  const work: Promise<void>[] = [];
  const service = new HostedServerService(
    {
      DB: sqliteD1(database),
      HOSTED_SERVERS_ENABLED: "true",
      BOAT_API_KEY: "boat-key",
      BOAT_WEBHOOK_SECRET: "webhook-secret",
      HOSTED_SERVER_TEMPLATE: "tpl_1",
      HOSTED_POOL_ALERT_WEBHOOK_URL: ALERT_URL,
      REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ kty: "EC", crv: "P-256", d: "private-value-of-the-test-key" }),
      ...(options.archiveKeys === false
        ? {}
        : {
            HOSTED_ARCHIVE_KEY_SECRET: WRAP_SECRET.toString("base64"),
            B2_WORKER_KEY_ID_EU: B2_WORKER.id,
            B2_WORKER_APPLICATION_KEY_EU: B2_WORKER.secret,
          }),
    },
    {
      fetch: boatFetch,
      now: () => clock.now,
      removeHost: () => Effect.void,
      billing,
      schedule: (effect) => work.push(Effect.runPromise(effect)),
    },
  );
  const settle = () => Promise.all(work.splice(0));

  const tokens = new Map<string, string>();
  let added = 0;
  const machine = async (id: number) => {
    const hostId = `leaseweb:${id}`;
    const token = randomToken();
    tokens.set(hostId, token);
    added += 1;
    database
      .prepare(
        `INSERT INTO operator_hosts(host_id, location, product, added_at, assign_token_hash, seen_at)
         VALUES (?, 'AMS-01', 'VPS02', ?, ?, ?)`,
      )
      .run(hostId, added, await Effect.runPromise(sha256(token)), clock.now);
    return hostId;
  };
  const machineToken = (hostId: string) =>
    database.prepare("SELECT assign_token_hash FROM operator_hosts WHERE host_id = ?").get(hostId)?.assign_token_hash ??
    null;
  const poll = (hostId: string, restoreVersion?: number, restored?: string) =>
    Effect.runPromise(service.poolAssignment(hostId, tokens.get(hostId), restoreVersion, restored));
  const pollFailure = (hostId: string, restoreVersion?: number, restored?: string) =>
    failure(service.poolAssignment(hostId, tokens.get(hostId), restoreVersion, restored));

  const archived = (planEndedAt: number) => {
    const serverId = randomUUID();
    database
      .prepare(
        `INSERT INTO hosted_servers(
           server_id, owner_user_id, name, provider_template, operator_host, size, plan, billing_interval, currency,
           desired_state, observed_state, observed_error, idempotency_key, plan_ended_at, created_at, updated_at
         ) VALUES (?, ?, 'Archived', NULL, NULL, 'default', 'standard', 'month', 'eur', 'stopped', 'stopped',
           'plan_ended', ?, ?, 1, ?)`,
      )
      .run(serverId, OWNER.id, `key-${serverId}`, planEndedAt, planEndedAt);
    database
      .prepare(
        `INSERT INTO billing_subscriptions(
           stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, amount, status,
           current_period_end, cancel_at_period_end, updated_at
         ) VALUES (?, ?, 'cus_1', ?, 'standard', 'month', 'eur', 900, 'canceled', ?, 0, ?)`,
      )
      .run(`sub_${serverId}`, OWNER.id, serverId, planEndedAt, planEndedAt);
    const { identity, archive } = storedArchive(serverId, planEndedAt + HOUR);
    database
      .prepare(
        `INSERT INTO hosted_server_archives(object_key, server_id, region, bucket, version_id, size_bytes, sha256,
           wrapped_key, plan_ended_at, delete_after, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        archive.object_key,
        serverId,
        archive.region,
        archive.bucket,
        archive.version_id,
        archive.size_bytes,
        archive.sha256,
        archive.wrapped_key,
        planEndedAt,
        planEndedAt + OPERATOR_HOST_DATA_KEPT_MS,
        planEndedAt + HOUR,
      );
    return { serverId, identity, archive };
  };
  const subscription = async (serverId: string, status: "active" | "canceled") => {
    database
      .prepare(
        "UPDATE billing_subscriptions SET status = ?, current_period_end = ?, updated_at = ? WHERE server_id = ?",
      )
      .run(status, clock.now + 30 * DAY, clock.now, serverId);
    await Effect.runPromise(
      service.onSubscriptionSynced({
        subscriptionId: `sub_${serverId}`,
        userId: OWNER.id,
        serverId,
        status,
        plan: "standard",
        interval: "month",
        currency: "eur",
        storageTier: 0,
      }),
    );
    await settle();
  };
  const row = (serverId: string) =>
    database
      .prepare(
        `SELECT desired_state, observed_state, observed_error, operator_host, provider_sandbox_id, last_wake_reason,
           claim_token_hash, start_requested_at FROM hosted_servers WHERE server_id = ?`,
      )
      .get(serverId);
  const archiveRow = (serverId: string) =>
    database.prepare("SELECT restored_at, deleted_at FROM hosted_server_archives WHERE server_id = ?").get(serverId);
  const listed = async (serverId: string) =>
    (await Effect.runPromise(service.list(OWNER))).servers.find((server) => server.serverId === serverId);
  const status = (serverId: string) => Effect.runPromise(service.status(OWNER, serverId));
  const tick = async (at: number) => {
    clock.now = at;
    await Effect.runPromise(service.tick(at));
    await settle();
  };
  return {
    t0,
    clock,
    alerts,
    sandboxes,
    machine,
    machineToken,
    poll,
    pollFailure,
    archived,
    subscription,
    row,
    archiveRow,
    listed,
    status,
    tick,
  };
}

async function renewRestoresFromThePool() {
  const w = world();
  const planEndedAt = w.t0 - 2 * DAY;
  const first = w.archived(planEndedAt);
  const endedSummary = await w.listed(first.serverId);
  check(
    "an archived server whose plan ended shows the date when its data is deleted",
    endedSummary?.state === "stopped" &&
      endedSummary.error === "plan_ended" &&
      endedSummary.dataKeptUntil === planEndedAt + OPERATOR_HOST_DATA_KEPT_MS &&
      endedSummary.restoring === undefined,
    endedSummary,
  );

  const machine = await w.machine(2001);
  await w.subscription(first.serverId, "active");
  const assigned = w.row(first.serverId);
  check(
    "a renewed archived server takes a ready pool machine for its restore, with no boat sandbox",
    assigned?.desired_state === "running" &&
      assigned.observed_state === "starting" &&
      assigned.operator_host === machine &&
      assigned.last_wake_reason === "restart" &&
      assigned.start_requested_at === w.clock.now &&
      typeof assigned.claim_token_hash === "string" &&
      w.sandboxes.length === 0,
    { row: assigned, sandboxes: w.sandboxes },
  );
  const restoringSummary = await w.listed(first.serverId);
  const restoringStatus = await w.status(first.serverId);
  check(
    "the list and the status show the restore as `starting` with `restoring`, and no delete date",
    restoringSummary?.state === "starting" &&
      restoringSummary.restoring === true &&
      restoringSummary.dataKeptUntil === undefined &&
      restoringStatus.state === "starting" &&
      restoringStatus.restoring === true,
    { restoringSummary, restoringStatus },
  );

  const answer = await w.poll(machine, POOL_RESTORE_VERSION);
  const restore = answer.state === "assigned" ? answer.restore : undefined;
  check(
    "the machine gets the server, a claim, the age key, a one-hour download URL, the checksum and the size",
    answer.state === "assigned" &&
      answer.serverId === first.serverId &&
      answer.claim.length >= 16 &&
      restore?.key === first.identity &&
      restore.sha256 === first.archive.sha256 &&
      restore.bytes === first.archive.size_bytes &&
      new URL(restore.url).searchParams.get("versionId") === first.archive.version_id,
    { state: answer.state, serverId: answer.state === "assigned" ? answer.serverId : null },
  );
  check(
    "the answer is JSON that the sed patterns of openbot-pool-wait read",
    restore !== undefined &&
      JSON.stringify(answer).includes(`"restore":{"url":"${restore.url}"`) &&
      /"key":"AGE-SECRET-KEY-1[0-9A-Z]{58}"/u.test(JSON.stringify(answer)) &&
      /"sha256":"[0-9a-f]{64}"/u.test(JSON.stringify(answer)),
  );

  const other = await w.machine(2002);
  const wrongReport = await w.pollFailure(other, POOL_RESTORE_VERSION, first.serverId);
  const badId = await w.pollFailure(machine, POOL_RESTORE_VERSION, "not-a-server");
  check(
    "a restore report from another machine, or with a bad server ID, is refused",
    wrongReport?.status === 401 && badId?.status === 401 && w.row(first.serverId)?.observed_state === "starting",
    { wrongReport, badId },
  );

  w.clock.now += 20 * MINUTE;
  const report = await w.poll(machine, POOL_RESTORE_VERSION, first.serverId);
  const reportedRow = w.row(first.serverId);
  const reportedArchive = w.archiveRow(first.serverId);
  const retry = await w.poll(machine, POOL_RESTORE_VERSION, first.serverId);
  check(
    "the restore report marks the archive restored and the server running, and a retry gets the same answer",
    report.state === "restored" &&
      retry.state === "restored" &&
      reportedRow?.observed_state === "running" &&
      reportedArchive?.restored_at === w.clock.now &&
      reportedArchive.deleted_at === null &&
      w.machineToken(machine) !== null,
    { report, retry, row: reportedRow, archive: reportedArchive },
  );
  const runningSummary = await w.listed(first.serverId);
  check(
    "a restored server shows `running` with no `restoring`",
    runningSummary?.state === "running" && runningSummary.restoring === undefined,
    runningSummary,
  );
  await w.tick(w.clock.now + MINUTE);
  const afterTick = await w.pollFailure(machine, POOL_RESTORE_VERSION, first.serverId);
  check(
    "the next tick removes the offer token of the restored machine",
    w.machineToken(machine) === null && afterTick?.status === 401,
    { token: w.machineToken(machine), afterTick },
  );
}

async function restoreWaitsAndOldMachinesStepAside() {
  const w = world();
  const waiting = w.archived(w.t0 - 3 * DAY);
  await w.subscription(waiting.serverId, "active");
  const waited = w.row(waiting.serverId);
  const waitAlerts = () => w.alerts.filter((alert) => alert.startsWith("🛠️ **Restore waits**"));
  check(
    "with no ready machine, a renewed archived server waits for one and does not start empty in a boat sandbox",
    waited?.desired_state === "running" &&
      waited.observed_state === "awaiting_payment" &&
      waited.operator_host === null &&
      waited.start_requested_at === w.t0 &&
      w.sandboxes.length === 0 &&
      waitAlerts().length === 1 &&
      waitAlerts()[0] ===
        `🛠️ **Restore waits** · standard server · eur · ${waiting.serverId.slice(0, 8)} · no ready VPS02 in AMS-01`,
    { row: waited, alerts: w.alerts },
  );
  const waitingStatus = await w.status(waiting.serverId);
  check(
    "a waiting restore shows `starting` with `restoring`",
    waitingStatus.state === "starting" && waitingStatus.restoring === true,
    waitingStatus,
  );
  await w.tick(w.t0 + 5 * MINUTE);
  check(
    "the next tick tries again with no second alert and no boat sandbox",
    waitAlerts().length === 1 && w.sandboxes.length === 0 && w.row(waiting.serverId)?.operator_host === null,
    { alerts: w.alerts },
  );

  w.clock.now = w.t0 + 10 * MINUTE;
  const old = await w.machine(3001);
  await w.tick(w.clock.now);
  check(
    "a tick gives the waiting restore a machine that became ready",
    w.row(waiting.serverId)?.operator_host === old && w.row(waiting.serverId)?.observed_state === "starting",
    w.row(waiting.serverId),
  );
  const oldAnswer = await w.poll(old);
  const released = w.row(waiting.serverId);
  check(
    "a machine whose openbot-pool-wait cannot restore gets no server, loses its offer, and the operator gets an alert",
    oldAnswer.state === "waiting" &&
      released?.operator_host === null &&
      released.observed_state === "awaiting_payment" &&
      released.claim_token_hash === null &&
      w.machineToken(old) === null &&
      w.alerts.at(-1) ===
        `🛠️ **Pool restore lost** · standard server · ${waiting.serverId.slice(0, 8)} · machine ${old} · its openbot-pool-wait cannot restore an archive · prepare it again`,
    { answer: oldAnswer, row: released, alert: w.alerts.at(-1) },
  );

  w.clock.now = w.t0 + 15 * MINUTE;
  const fresh = await w.machine(3002);
  await w.tick(w.clock.now);
  check(
    "the released restore takes the next ready machine",
    w.row(waiting.serverId)?.operator_host === fresh && w.sandboxes.length === 0,
    w.row(waiting.serverId),
  );
  const assignedAt = w.clock.now;
  await w.tick(assignedAt + 2 * HOUR);
  check(
    "a restore that runs for 2 hours keeps its machine",
    w.row(waiting.serverId)?.operator_host === fresh,
    w.row(waiting.serverId),
  );
  await w.tick(assignedAt + 3 * HOUR + MINUTE);
  const lost = w.row(waiting.serverId);
  check(
    "a restore with no report in 3 hours leaves its machine, which loses its offer, and the operator gets an alert",
    lost?.operator_host !== fresh &&
      w.machineToken(fresh) === null &&
      w.archiveRow(waiting.serverId)?.restored_at === null &&
      w.alerts.some(
        (alert) =>
          alert ===
          `🛠️ **Pool restore lost** · standard server · ${waiting.serverId.slice(0, 8)} · machine ${fresh} · no restore report in 3 h · it can have customer data · install it again`,
      ),
    { row: lost, alerts: w.alerts },
  );
}

async function restoreWaitEndsWithThePlan() {
  const w = world();
  const planEndedAt = w.t0 - DAY;
  const waiting = w.archived(planEndedAt);
  await w.subscription(waiting.serverId, "active");
  const before = w.row(waiting.serverId);
  w.clock.now = w.t0 + MINUTE;
  await w.subscription(waiting.serverId, "canceled");
  await w.tick(w.t0 + 10 * MINUTE);
  const ended = w.row(waiting.serverId);
  const endedSummary = await w.listed(waiting.serverId);
  check(
    "a plan that ends while its restore waits stops the server and keeps the archive, with no delete of the server",
    before?.observed_state === "awaiting_payment" &&
      ended?.desired_state === "stopped" &&
      ended.observed_state === "stopped" &&
      ended.observed_error === "plan_ended" &&
      w.archiveRow(waiting.serverId)?.deleted_at === null &&
      endedSummary?.dataKeptUntil === planEndedAt + OPERATOR_HOST_DATA_KEPT_MS,
    { before, ended, summary: endedSummary },
  );

  const noKeys = world({ archiveKeys: false });
  const blocked = noKeys.archived(noKeys.t0 - DAY);
  await noKeys.machine(4001);
  await noKeys.subscription(blocked.serverId, "active");
  check(
    "a Worker with no archive keys does not give an archived server a machine or a boat sandbox, and alerts once",
    noKeys.row(blocked.serverId)?.operator_host === null &&
      noKeys.sandboxes.length === 0 &&
      noKeys.alerts.filter((alert) => alert.endsWith("· the Worker has no archive keys")).length === 1,
    { row: noKeys.row(blocked.serverId), alerts: noKeys.alerts },
  );
}

function noStripeCalls() {
  check(
    "the restore makes no Stripe call",
    stripeCallsOfAllWorlds.every((calls) => calls.length === 0),
    stripeCallsOfAllWorlds,
  );
}

let passed = false;
try {
  await workerOpensTheNodeArchive();
  await renewRestoresFromThePool();
  await restoreWaitsAndOldMachinesStepAside();
  await restoreWaitEndsWithThePlan();
  noStripeCalls();
  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) console.log(`${item.passed ? "ok  " : "FAIL"} ${item.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exit(1);
