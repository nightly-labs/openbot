// Runs the real account server hosted-server service on a migrated SQLite database, with a boat API
// that records each call and the real billing service with a Stripe that must get no call. An operator
// moved three servers from boat to machines that the operator runs (`operator_host`), so the row has no
// sandbox. For such a server the Worker must send no boat call and must never make a sandbox: a new one
// would be an empty second server with the same identity. The Worker writes only what the server must
// do (`desired_state`): the plan end, the renewal and the plan change. The operator starts and stops the
// machine. A delete removes the boat sandbox from before the move, the Remote host and the session, and
// keeps the name of the machine until the operator erases it. The server list tells a client that the
// account service cannot restart a moved server, so the client hides the action. A moved server has the
// larger storage of its plan in the server list, the hosting list and the billing state, also after a
// plan change. Servers that boat runs show that the same service still sets up, starts, stops and
// resizes them, and that they keep the storage of the plan table. A move that the operator writes while
// the Worker reads the sandbox at boat wins over the state that boat then gives.
//
// Run: bun run test:hosted-operator-host
// It writes .openbot-build/hosted-operator-host-e2e/report.json and exits non-zero on a failure.
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect, Result } from "effect";
import { BillingService } from "../src/server/billing-service";
import { sha256 } from "../src/server/crypto";
import { HostedServerService } from "../src/server/hosted-server-service";
import { RemoteControlPlane } from "../src/server/remote-control-plane";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "hosted-operator-host-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const WEBHOOK_SECRET = "webhook-secret";
const OWNER = {
  id: "owner",
  email: "owner@example.test",
  name: null,
  avatarUrl: null,
  analyticsEnabled: null,
  chatColor: null,
};
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MACHINE = "leaseweb:12728110";

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

async function signedWebhook(deliveryId: string, at: number, body: string) {
  const timestamp = String(Math.floor(at / 1000));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${deliveryId}.${timestamp}.${body}`));
  return { deliveryId, timestamp, signature: `v1=${Buffer.from(digest).toString("hex")}`, body };
}

async function run() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  const t0 = Date.UTC(2026, 10, 11, 12);
  const clock = { now: t0 };
  database
    .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
    .run(OWNER.id, `email:${OWNER.email}`, OWNER.email);
  const insert = database.prepare(
    `INSERT INTO hosted_servers(
       server_id, owner_user_id, name, provider_sandbox_id, provider_template, operator_host, retired_sandbox_id,
       size, plan, billing_interval, currency, desired_state, observed_state, observed_error, auth_session_id,
       idempotency_key, last_active_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'small', 'starter', 'month', 'eur', 'running', ?, ?, ?, ?, ?, 1, ?)`,
  );
  const subscribe = database.prepare(
    `INSERT INTO billing_subscriptions(
       stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, amount, status,
       current_period_end, cancel_at_period_end, updated_at
     ) VALUES (?, ?, 'cus_1', ?, 'starter', 'month', 'eur', 900, 'active', ?, 0, ?)`,
  );
  const server = (
    id: string,
    state: { sandboxId?: string; template?: string; machine?: string; retired?: string; observed: string },
  ) => {
    database
      .prepare(
        "INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, 1, 1)",
      )
      .run(`session-${id}`, OWNER.id, `hash-${id}`, t0 + 365 * DAY);
    insert.run(
      id,
      OWNER.id,
      `Server ${id}`,
      state.sandboxId ?? null,
      state.template ?? null,
      state.machine ?? null,
      state.retired ?? null,
      state.observed,
      state.observed === "error" ? "provider_error" : null,
      `session-${id}`,
      `key-${id}`,
      t0,
      t0 - 20 * MINUTE,
    );
    subscribe.run(`sub_${id}`, OWNER.id, id, t0 + 30 * DAY, t0);
  };
  // Servers that boat runs: a failed setup with no sandbox, and a stopped server that must run.
  server("control-setup", { observed: "error" });
  server("control-stopped", { sandboxId: "bx_control_stopped", template: "tpl_1", observed: "stopped" });
  // Servers that an operator moved. The row of a moved server keeps its template.
  server("moved", { template: "tpl_1", machine: MACHINE, retired: "bx_old", observed: "running" });
  server("gone", { template: "tpl_1", machine: "leaseweb:12728111", retired: "bx_gone", observed: "running" });
  server("bare", { machine: "leaseweb:12728112", observed: "running" });

  const calls: string[] = [];
  const running = new Set<string>();
  /** Runs one time while boat answers a read of this sandbox: the operator moves the server at that moment. */
  const duringRead = new Map<string, () => void>();
  const boatFetch = async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname.replace("/api/v1", "");
    const method = init.method ?? "GET";
    if (method === "POST" && path === "/sandboxes") {
      const hostId = String(JSON.parse(String(init.body)).env.OPENBOT_HOSTED_HOST_ID);
      const sandboxId = `bx_${hostId.replaceAll("-", "_")}`;
      calls.push(`POST /sandboxes for ${hostId}`);
      running.add(sandboxId);
      return Response.json({ ok: true, sandbox: { id: sandboxId, state: "running" } });
    }
    calls.push(`${method} ${path}`);
    const sandboxId = decodeURIComponent(path.split("/")[2] ?? "");
    if (path.endsWith("/resume")) {
      running.add(sandboxId);
      return Response.json({ ok: true, status: "resuming" });
    }
    if (path.endsWith("/stop")) {
      running.delete(sandboxId);
      return Response.json({ ok: true });
    }
    if (method === "DELETE" && sandboxId === "bx_gone") {
      return Response.json({ ok: false, code: "sandbox_not_found" }, { status: 404 });
    }
    if (method === "GET") {
      duringRead.get(sandboxId)?.();
      duringRead.delete(sandboxId);
      return Response.json({
        ok: true,
        sandbox: { id: sandboxId, state: running.has(sandboxId) ? "running" : "archived" },
      });
    }
    return Response.json({ ok: true });
  };
  // Each call for a server that boat runs names `control`. All other calls are for a moved server.
  const foreign = () => calls.filter((call) => !call.includes("control"));
  const stripeCalls: string[] = [];
  const billing = new BillingService({
    database: sqliteD1(database),
    secretKey: "sk_test_none",
    webhookSecret: null,
    fetch: async (input, init) => {
      stripeCalls.push(`${init.method ?? "GET"} ${new URL(input).pathname}`);
      return Response.json({ error: { type: "api_error" } }, { status: 500 });
    },
    now: () => clock.now,
  });
  const removed: string[] = [];
  const work: Promise<void>[] = [];
  const service = new HostedServerService(
    {
      DB: sqliteD1(database),
      HOSTED_SERVERS_ENABLED: "true",
      BOAT_API_KEY: "boat-key",
      BOAT_WEBHOOK_SECRET: WEBHOOK_SECRET,
      HOSTED_SERVER_TEMPLATE: "tpl_1",
      REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ kty: "EC", crv: "P-256", d: "private-value-of-the-test-key" }),
    },
    {
      fetch: boatFetch,
      now: () => clock.now,
      billing,
      removeHost: (_ownerUserId, hostId) =>
        Effect.sync(() => {
          removed.push(hostId);
        }),
      schedule: (effect) => work.push(Effect.runPromise(effect)),
    },
  );
  const tick = async (at: number) => {
    clock.now = at;
    const result = await Effect.runPromise(service.tick(at));
    await Promise.all(work.splice(0));
    return result;
  };
  const row = (serverId: string) =>
    database
      .prepare(
        `SELECT desired_state, observed_state, observed_error, provider_sandbox_id, operator_host, retired_sandbox_id,
           plan, size, pending_size, claim_token_hash, updated_at
         FROM hosted_servers WHERE server_id = ?`,
      )
      .get(serverId);
  /** A write that only the operator makes: what the machine does now. */
  const operatorSets = (serverId: string, observed: string, error: string | null, at: number) =>
    database
      .prepare("UPDATE hosted_servers SET observed_state = ?, observed_error = ?, updated_at = ? WHERE server_id = ?")
      .run(observed, error, at, serverId);
  const plan = (serverId: string, status: string, at: number, planId = "starter") =>
    database
      .prepare("UPDATE billing_subscriptions SET status = ?, plan = ?, updated_at = ? WHERE server_id = ?")
      .run(status, planId, at, serverId);
  const refused = async (operation: Effect.Effect<unknown, unknown>) => {
    const result = await Effect.runPromise(Effect.result(operation));
    if (Result.isSuccess(result)) return { status: null, code: "not refused" };
    const error = result.failure;
    return error instanceof Error && "status" in error && "code" in error
      ? { status: error.status, code: error.code }
      : { status: null, code: String(error) };
  };

  // The server list that each client reads. Before the first tick, so each server has its first state.
  const hostRow = database.prepare(
    "INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at) VALUES (?, ?, ?, 1, 1)",
  );
  const membershipRow = database.prepare(
    `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
     VALUES (?, ?, ?, 'owner', 'active', 1, 1)`,
  );
  for (const id of ["control-stopped", "moved", "own-computer"]) {
    hostRow.run(id, OWNER.id, `Server ${id}`);
    membershipRow.run(`membership-${id}`, id, OWNER.id);
  }
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const plane = new RemoteControlPlane(
    {
      DB: sqliteD1(database),
      REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "ticket-1" }),
      REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [{ ...publicJwk, kid: "ticket-1" }] }),
      REMOTE_TICKET_KEY_ID: "ticket-1",
    },
    { now: () => clock.now },
  );
  const listed = (await Effect.runPromise(plane.listHosts(OWNER.id))).map((host) => ({
    hostId: host.hostId,
    hosted: host.hosted,
    restartAvailable: "restartAvailable" in host ? host.restartAvailable : undefined,
  }));
  /** The storage of a server in each answer that a client or the host reads. */
  const storage = async (serverId: string) => {
    const host = (await Effect.runPromise(plane.listHosts(OWNER.id))).find((entry) => entry.hostId === serverId);
    const hosting = (await Effect.runPromise(service.list(OWNER))).servers.find((entry) => entry.serverId === serverId);
    const plans = (await Effect.runPromise(billing.getState(OWNER.id))).servers;
    return {
      serverList: host && "storageGb" in host ? host.storageGb : undefined,
      hostingList: hosting?.storageGb,
      billing: plans.find((entry) => entry.serverId === serverId)?.storageGb,
    };
  };
  const sameStorage = (found: Awaited<ReturnType<typeof storage>>, storageGb: number) =>
    found.serverList === storageGb && found.hostingList === storageGb && found.billing === storageGb;
  const starterStorage = { moved: await storage("moved"), boat: await storage("control-stopped") };
  check(
    "a moved Starter server has 25 GB and a boat Starter server has 12 GB, in each list",
    sameStorage(starterStorage.moved, 25) && sameStorage(starterStorage.boat, 12),
    starterStorage,
  );
  const ownComputer = await storage("own-computer");
  check(
    "a server that is not hosted has no storage in the server list",
    ownComputer.serverList === undefined && ownComputer.hostingList === undefined,
    ownComputer,
  );
  const listedHost = (id: string) => listed.find((host) => host.hostId === id);
  check(
    "the server list marks a moved server as hosted and says that it has no restart",
    listedHost("moved")?.hosted === true && listedHost("moved")?.restartAvailable === false,
    { listed },
  );
  check(
    "the server list keeps the restart of a boat server and of a server that is not hosted",
    listedHost("control-stopped")?.hosted === true &&
      listedHost("control-stopped")?.restartAvailable === undefined &&
      listedHost("own-computer")?.hosted === false &&
      listedHost("own-computer")?.restartAvailable === undefined,
    { listed },
  );

  const first = await tick(t0);
  check(
    "the cron sets up a failed boat server again and starts a stopped one",
    calls.includes("POST /sandboxes for control-setup") &&
      calls.includes("POST /sandboxes/bx_control_stopped/resume") &&
      row("control-setup")?.provider_sandbox_id === "bx_control_setup",
    { calls, result: first },
  );
  for (let minute = 5; minute <= 60; minute += 5) await tick(t0 + minute * MINUTE);
  check(
    "the idle rule stops the boat server that has no use",
    calls.includes("POST /sandboxes/bx_control_setup/stop") && row("control-setup")?.desired_state === "idle",
    { calls, row: row("control-setup") },
  );
  const untouched = row("moved");
  check(
    "an hour of cron time sends no boat call for a moved server and does not write its row",
    foreign().length === 0 &&
      untouched?.desired_state === "running" &&
      untouched.observed_state === "running" &&
      untouched.updated_at === t0 - 20 * MINUTE,
    { calls: foreign(), row: untouched },
  );

  let at = t0 + 61 * MINUTE;
  clock.now = at;
  const woken = await Effect.runPromise(service.wake(OWNER, "moved"));
  check(
    "a start request of the owner changes nothing and sends no boat call",
    woken.state === "running" && foreign().length === 0 && row("moved")?.updated_at === t0 - 20 * MINUTE,
    { summary: woken, calls: foreign() },
  );

  // OpenBot on the machine reports its use with the session from before the move.
  database
    .prepare("UPDATE auth_sessions SET token_hash = ? WHERE id = 'session-moved'")
    .run(await Effect.runPromise(sha256("token-moved")));
  await Effect.runPromise(service.reportActivity("token-moved", "moved", { inUse: true, nextRunAt: at + 10 * MINUTE }));
  const reported = database
    .prepare(
      "SELECT last_active_at, next_run_at, lease_until, desired_state, observed_state FROM hosted_servers WHERE server_id = 'moved'",
    )
    .get();
  check(
    "a use report of a moved server is stored and sends no boat call",
    foreign().length === 0 &&
      reported?.last_active_at === at &&
      reported.next_run_at === at + 10 * MINUTE &&
      reported.lease_until === null &&
      reported.desired_state === "running" &&
      reported.observed_state === "running",
    { calls: foreign(), row: reported },
  );

  // The recovery of a machine that lost its session: the operator writes the hash of a new claim.
  database
    .prepare("UPDATE hosted_servers SET claim_token_hash = ?, claim_expires_at = ? WHERE server_id = 'bare'")
    .run(await Effect.runPromise(sha256("operator-claim-for-bare")), at + 60 * MINUTE);
  const claimed = await Effect.runPromise(service.redeemClaim("operator-claim-for-bare"));
  const oldSession = database.prepare("SELECT revoked_at FROM auth_sessions WHERE id = 'session-bare'").get();
  await Effect.runPromise(service.reportActivity(claimed.sessionToken, "bare", { inUse: true }));
  check(
    "a claim that the operator writes signs a moved server in again and ends its old session",
    claimed.hostId === "bare" &&
      oldSession?.revoked_at === at &&
      foreign().length === 0 &&
      row("bare")?.observed_state === "running",
    { hostId: claimed.hostId, oldSession, calls: foreign(), row: row("bare") },
  );

  // The sandbox from before the move still sends events while the operator stops and deletes it.
  const body = JSON.stringify({
    type: "sandbox.archived",
    createdAt: new Date(at).toISOString(),
    data: { sandbox: { id: "bx_old" } },
  });
  await Effect.runPromise(service.handleWebhook(await signedWebhook("delivery-retired", at, body)));
  check(
    "a boat event for the sandbox from before the move does not change the server",
    row("moved")?.observed_state === "running" && foreign().length === 0,
    row("moved"),
  );

  // The operator moves a server while the Worker reads its sandbox at boat. The Worker read the row before
  // the move, and boat then says that the sandbox is stopped.
  server("control-race", { sandboxId: "bx_control_race", template: "tpl_1", observed: "stopping" });
  duringRead.set("bx_control_race", () => {
    database
      .prepare(
        `UPDATE hosted_servers SET operator_host = 'leaseweb:12728113', retired_sandbox_id = provider_sandbox_id,
           provider_sandbox_id = NULL, desired_state = 'running', observed_state = 'running', observed_error = NULL,
           updated_at = ?
         WHERE server_id = 'control-race' AND provider_sandbox_id IS NOT NULL AND operator_host IS NULL
           AND desired_state IN ('running', 'idle')`,
      )
      .run(at);
  });
  const raceFrom = calls.length;
  const ready = JSON.stringify({
    type: "sandbox.ready",
    createdAt: new Date(at).toISOString(),
    data: { state: "running", sandbox: { id: "bx_control_race" } },
  });
  await Effect.runPromise(service.handleWebhook(await signedWebhook("delivery-race", at, ready)));
  await Promise.all(work.splice(0));
  const raced = row("control-race");
  check(
    "a move during a read of the sandbox wins: the old state of the sandbox does not change the moved server",
    raced?.operator_host === "leaseweb:12728113" &&
      raced.desired_state === "running" &&
      raced.observed_state === "running" &&
      calls.slice(raceFrom).join() === "GET /sandboxes/bx_control_race",
    { row: raced, calls: calls.slice(raceFrom) },
  );
  // The other checks do not use this server.
  database.prepare("DELETE FROM billing_subscriptions WHERE server_id = 'control-race'").run();
  database.prepare("DELETE FROM hosted_servers WHERE server_id = 'control-race'").run();

  // The states in which the Worker makes or starts a sandbox for a server that boat runs.
  operatorSets("moved", "error", "provider_error", at - 20 * MINUTE);
  await Effect.runPromise(service.wake(OWNER, "moved"));
  await tick(at);
  const failed = row("moved");
  check(
    "a moved server in the error state never gets a new sandbox, from a client or from the cron",
    foreign().length === 0 && failed?.observed_state === "error" && failed.provider_sandbox_id === null,
    { calls: foreign(), row: failed },
  );
  operatorSets("moved", "stopped", null, at - 20 * MINUTE);
  await Effect.runPromise(service.wake(OWNER, "moved"));
  await Effect.runPromise(service.startForRoute("moved"));
  await tick(at);
  const down = row("moved");
  check(
    "a moved server that is stopped is not started by boat and does not wait for a boat event",
    foreign().length === 0 && down?.observed_state === "stopped" && down.desired_state === "running",
    { calls: foreign(), row: down },
  );
  operatorSets("moved", "running", null, at);

  const restart = await refused(service.restart(OWNER, "moved"));
  check(
    "a restart of a moved server is refused with its own error",
    restart.status === 409 && restart.code === "hosted_server_restart_unavailable" && foreign().length === 0,
    restart,
  );

  // A plan change: boat changes the machine on a resume. The operator machine has one size.
  at += 10 * MINUTE;
  clock.now = at;
  for (const serverId of ["moved", "control-stopped"]) {
    plan(serverId, "active", at, "pro");
    await Effect.runPromise(
      service.onSubscriptionSynced({
        subscriptionId: `sub_${serverId}`,
        userId: OWNER.id,
        serverId,
        status: "active",
        plan: "pro",
        interval: "month",
        currency: "eur",
      }),
    );
  }
  await Promise.all(work.splice(0));
  const changed = row("moved");
  const boatChanged = row("control-stopped");
  check(
    "a plan change gives a moved server its new size at once, with no resize to wait for",
    changed?.plan === "pro" && changed.size === "large" && changed.pending_size === null && foreign().length === 0,
    { row: changed, calls: foreign() },
  );
  check(
    "a plan change of a boat server still waits for a resize",
    boatChanged?.plan === "pro" && boatChanged.size === "small" && boatChanged.pending_size === "large",
    boatChanged,
  );
  const proStorage = { moved: await storage("moved"), boat: await storage("control-stopped") };
  check(
    "after a change to Pro, a moved server has 150 GB and a boat server has 100 GB, in each list",
    sameStorage(proStorage.moved, 150) && sameStorage(proStorage.boat, 100),
    proStorage,
  );

  // The plan ends: the Worker records that the server must stop. The operator stops the machine.
  plan("moved", "canceled", at, "pro");
  at += 3 * MINUTE;
  const ending = await tick(at);
  const ended = row("moved");
  check(
    "the end of the plan tells the operator to stop the server and sends no boat call",
    ending.stopped >= 1 &&
      ended?.desired_state === "stopped" &&
      ended.observed_error === "plan_ended" &&
      ended.observed_state === "running" &&
      foreign().length === 0,
    { result: ending, row: ended, calls: foreign() },
  );
  const noPlan = await refused(service.wake(OWNER, "moved"));
  const routeState = await Effect.runPromise(service.routeState("moved"));
  check(
    "a server whose plan ended refuses a start, and a connector event does not start it",
    noPlan.status === 402 && noPlan.code === "plan_required" && routeState === "ended",
    { wake: noPlan, routeState },
  );
  for (let slot = 1; slot <= 3; slot += 1) await tick(at + slot * 5 * MINUTE);
  at += 15 * MINUTE;
  check(
    "the cron sends no stop to boat for a moved server that still runs",
    foreign().length === 0 && row("moved")?.observed_state === "running",
    { calls: foreign(), row: row("moved") },
  );
  operatorSets("moved", "stopped", "plan_ended", at);

  // The owner pays again: the Worker records that the server must run. The operator starts the machine.
  plan("moved", "active", at, "pro");
  at += 3 * MINUTE;
  await tick(at);
  const renewed = row("moved");
  check(
    "a renewal tells the operator to start the server and makes no new sandbox",
    renewed?.desired_state === "running" &&
      renewed.observed_error === null &&
      renewed.observed_state === "stopped" &&
      renewed.provider_sandbox_id === null &&
      foreign().length === 0,
    { row: renewed, calls: foreign() },
  );
  for (let slot = 1; slot <= 3; slot += 1) await tick(at + slot * 5 * MINUTE);
  at += 15 * MINUTE;
  check(
    "the renewed server waits for the operator: no boat start and no sign-in claim from the cron",
    foreign().length === 0 && row("moved")?.observed_state === "stopped" && row("moved")?.claim_token_hash === null,
    { calls: foreign(), row: row("moved") },
  );
  operatorSets("moved", "running", null, at);

  // A delete. The plan is closed first, so the real billing service has no Stripe call to make.
  for (const serverId of ["moved", "gone", "bare"]) plan(serverId, "canceled", at, "pro");
  clock.now = at;
  await Effect.runPromise(service.delete(OWNER, "moved", "Server moved"));
  await Promise.all(work.splice(0));
  const deleted = row("moved");
  const session = (serverId: string) =>
    database.prepare("SELECT revoked_at FROM auth_sessions WHERE id = ?").get(`session-${serverId}`);
  check(
    "a delete removes the boat sandbox from before the move, and only that",
    foreign().length === 1 && foreign()[0] === "DELETE /sandboxes/bx_old",
    foreign(),
  );
  check(
    "the deleted server loses its Remote host and its session",
    removed.includes("moved") && session("moved")?.revoked_at === at && deleted?.observed_state === "deleted",
    { removed, session: session("moved"), row: deleted },
  );
  check(
    "the deleted row keeps the name of the machine, so the operator knows which one to erase",
    deleted?.operator_host === MACHINE && deleted.retired_sandbox_id === "bx_old",
    deleted,
  );
  await Effect.runPromise(service.delete(OWNER, "gone", "Server gone"));
  check(
    "a sandbox that is gone at boat does not stop the delete",
    foreign().at(-1) === "DELETE /sandboxes/bx_gone" && row("gone")?.observed_state === "deleted",
    { calls: foreign(), row: row("gone") },
  );
  await Effect.runPromise(service.delete(OWNER, "bare", "Server bare"));
  check(
    "a moved server with no boat sandbox is deleted with no boat call",
    foreign().length === 2 && row("bare")?.observed_state === "deleted" && removed.includes("bare"),
    { calls: foreign(), row: row("bare") },
  );
  const last = await tick(at + 5 * MINUTE);
  check(
    "the cron has no more work for the deleted servers",
    foreign().length === 2 && last.deleted === 0 && last.failed === 0,
    { calls: foreign(), result: last },
  );
  check("Stripe got no call", stripeCalls.length === 0, stripeCalls);
  database.close();
}

let passed = false;
try {
  await run();
  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) console.log(`${item.passed ? "ok  " : "FAIL"} ${item.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exit(1);
