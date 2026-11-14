// Runs the real account server hosted-server service on a migrated SQLite database with a fake boat API
// that records each sandbox it makes. A purchase (`onSubscriptionSynced`) with a free prepared machine of
// the plan's product in the pool starts on that machine with no boat sandbox, and a purchase with no such
// machine starts in a boat sandbox. The machine gets its server and claim with its token (`poolAssignment`),
// the sign-in of OpenBot (`redeemClaim`) sets the server to `running`, and a machine that does not sign in
// loses the server to boat. It also checks the `machine` property of the analytics events, and the operator
// alerts of the pool (a start on boat, and a pool group with at most one free machine).
//
// Run: bun run test:hosted-pool-assignment
// It writes .openbot-build/hosted-pool-assignment-e2e/report.json and exits non-zero on a failure.
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BillingPlanId } from "@openbot/contracts/billing";
import { HOSTED_PLAN_SIZE } from "@openbot/contracts/hosted-servers";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result } from "effect";
import {
  ACCOUNT_ANALYTICS_SCHEMA_VERSION,
  type AccountAnalyticsEvent,
  createAccountAnalytics,
} from "../src/server/account-analytics";
import { randomToken, sha256 } from "../src/server/crypto";
import { HostedServerService } from "../src/server/hosted-server-service";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "hosted-pool-assignment-e2e");
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
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

type Action = Extract<AccountAnalyticsEvent, { name: "hosted_server_action" }>;

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  return database;
}

/** The status and code of a refused call, or null when the call worked. */
async function refusal(call: Effect.Effect<unknown, unknown>) {
  const result = await Effect.runPromise(Effect.result(call));
  if (Result.isSuccess(result)) return null;
  const failure = result.failure;
  return isDynamicRecord(failure) ? { status: failure.status, code: failure.code } : { status: null, code: null };
}

async function purchaseStartsOnThePoolOrOnBoat() {
  const database = migratedDatabase();
  const t0 = Date.UTC(2026, 10, 13, 12);
  const clock = { now: t0 };
  database
    .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
    .run(OWNER.id, `email:${OWNER.email}`, OWNER.email);

  const created: { serverId: string; from: string; claim: string; type: string }[] = [];
  const alerts: string[] = [];
  const boatFetch = async (input: string, init: RequestInit) => {
    if (input === ALERT_URL) {
      alerts.push(String(JSON.parse(String(init.body)).content));
      return new Response(null, { status: 204 });
    }
    const path = new URL(input).pathname.replace("/api/v1", "");
    const method = init.method ?? "GET";
    if (method === "POST" && path === "/sandboxes") {
      const body = JSON.parse(String(init.body));
      const serverId = String(body.env.OPENBOT_HOSTED_HOST_ID);
      created.push({
        serverId,
        from: String(body.from),
        claim: String(body.env.OPENBOT_HOSTED_CLAIM),
        type: String(body.type),
      });
      return Response.json({ ok: true, sandbox: { id: `bx_${serverId}`, state: "provisioning" } });
    }
    if (path.endsWith("/commands"))
      return Response.json({ ok: true, type: "command.finished", exitCode: 0, stdout: "", stderr: "" });
    if (method === "GET") {
      const sandboxId = decodeURIComponent(path.split("/")[2] ?? "");
      return Response.json({ ok: true, sandbox: { id: sandboxId, state: "provisioning" } });
    }
    return Response.json({ ok: true });
  };
  const sandboxOf = (serverId: string) => created.filter((entry) => entry.serverId === serverId);
  /** For the report: the sandboxes with no claim. */
  const sandboxes = () => created.map((entry) => ({ serverId: entry.serverId, from: entry.from, type: entry.type }));

  const tracked: Action[] = [];
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
    },
    {
      fetch: boatFetch,
      now: () => clock.now,
      removeHost: () => Effect.void,
      schedule: (effect) => work.push(Effect.runPromise(effect)),
      analytics: {
        track: (_account, event) => {
          if (event.name === "hosted_server_action") tracked.push(event);
        },
      },
    },
  );
  const events = (action: Action["action"], machine?: Action["machine"]) =>
    tracked.filter((event) => event.action === action && (machine === undefined || event.machine === machine));

  const tokens = new Map<string, string>();
  let added = 0;
  /** A machine of the pool. `ready` gives it a token and a poll at this moment, as the wait unit does. */
  const machine = async (
    id: number,
    product: string,
    location: string,
    state: { ready?: boolean; seenAt?: number | null; removed?: boolean } = { ready: true },
  ) => {
    const hostId = `leaseweb:${id}`;
    const token = randomToken();
    tokens.set(hostId, token);
    added += 1;
    database
      .prepare(
        `INSERT INTO operator_hosts(host_id, location, product, added_at, removed_at, assign_token_hash, seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        hostId,
        location,
        product,
        added,
        state.removed ? clock.now : null,
        state.ready === false ? null : await Effect.runPromise(sha256(token)),
        state.seenAt === undefined ? clock.now : state.seenAt,
      );
    return hostId;
  };
  const machineRow = (hostId: string) =>
    database.prepare("SELECT assign_token_hash, seen_at FROM operator_hosts WHERE host_id = ?").get(hostId);
  const poll = (hostId: string, token = tokens.get(hostId)) => Effect.runPromise(service.poolAssignment(hostId, token));

  const insertServer = database.prepare(
    `INSERT INTO hosted_servers(
       server_id, owner_user_id, name, provider_template, operator_host, size, plan, billing_interval, currency,
       desired_state, observed_state, idempotency_key, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'month', ?, 'running', ?, ?, ?, ?)`,
  );
  const insertPlan = database.prepare(
    `INSERT INTO billing_subscriptions(
       stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, amount, status,
       current_period_end, cancel_at_period_end, updated_at
     ) VALUES (?, ?, 'cus_1', ?, ?, 'month', ?, 900, 'active', ?, 0, ?)`,
  );
  /** The owner made the server and paid: Stripe stored the subscription, and the Worker follows it. */
  const purchase = async (serverId: string, plan: BillingPlanId, currency: string, template: string | null = null) => {
    insertServer.run(
      serverId,
      OWNER.id,
      `Server ${serverId}`,
      template,
      null,
      HOSTED_PLAN_SIZE[plan],
      plan,
      currency,
      "awaiting_payment",
      `key-${serverId}`,
      clock.now,
      clock.now,
    );
    insertPlan.run(`sub_${serverId}`, OWNER.id, serverId, plan, currency, clock.now + 30 * DAY, clock.now);
    await Effect.runPromise(
      service.onSubscriptionSynced({
        subscriptionId: `sub_${serverId}`,
        userId: OWNER.id,
        serverId,
        status: "active",
        plan,
        interval: "month",
        currency: currency === "usd" ? "usd" : "eur",
      }),
    );
    await Promise.all(work.splice(0));
  };
  const row = (serverId: string) =>
    database
      .prepare(
        `SELECT desired_state, observed_state, observed_error, operator_host, provider_sandbox_id, provider_template,
           claim_token_hash, claim_redeemed_at, start_requested_at, auth_session_id
         FROM hosted_servers WHERE server_id = ?`,
      )
      .get(serverId);
  const tick = async (at: number) => {
    clock.now = at;
    const result = await Effect.runPromise(service.tick(at));
    await Promise.all(work.splice(0));
    return result;
  };

  // The pool: two ready Standard machines, and machines that must get no server.
  const amsStandard = await machine(1001, "VPS02", "AMS-01");
  const wdcStandard = await machine(1002, "VPS02", "WDC-02");
  const amsPro = await machine(1003, "VPS03", "AMS-01");
  const stale = await machine(1004, "VPS02", "AMS-01", { seenAt: t0 - 10 * MINUTE });
  const neverSeen = await machine(1005, "VPS02", "AMS-01", { seenAt: null });
  const noToken = await machine(1006, "VPS02", "AMS-01", { ready: false });
  const removed = await machine(1007, "VPS02", "AMS-01", { removed: true });
  const taken = await machine(1008, "VPS02", "AMS-01");
  // A server that an operator moved to a machine: the machine is not free.
  insertServer.run(
    "moved",
    OWNER.id,
    "Server moved",
    "tpl_1",
    taken,
    "default",
    "standard",
    "eur",
    "running",
    "key-moved",
    1,
    1,
  );

  // 1. A purchase with a ready machine of the product starts there. The currency chooses the location first.
  await purchase("usd-1", "standard", "usd");
  await purchase("eur-1", "standard", "eur");
  const usd1 = row("usd-1");
  const eur1 = row("eur-1");
  check(
    "a US dollar purchase starts on the ready machine in WDC-02, with no boat sandbox",
    usd1?.operator_host === wdcStandard &&
      usd1.observed_state === "starting" &&
      usd1.provider_sandbox_id === null &&
      usd1.provider_template === null &&
      usd1.start_requested_at === t0 &&
      typeof usd1.claim_token_hash === "string" &&
      sandboxOf("usd-1").length === 0,
    { row: usd1, sandboxes: sandboxes() },
  );
  check(
    "a euro purchase starts on the ready machine in AMS-01, with no boat sandbox",
    eur1?.operator_host === amsStandard && eur1.observed_state === "starting" && sandboxOf("eur-1").length === 0,
    { row: eur1, sandboxes: sandboxes() },
  );
  check(
    "each pool start sends one provisioned event with the machine `pool`",
    events("provisioned", "pool").length === 2 && events("provisioned", "boat").length === 0,
    events("provisioned"),
  );

  // 2. No ready machine of the product is left: the next purchase starts on boat, as before.
  await purchase("eur-2", "standard", "eur");
  const eur2 = row("eur-2");
  check(
    "a purchase with no ready machine of its product starts in a boat sandbox",
    eur2?.operator_host === null &&
      eur2.provider_sandbox_id === "bx_eur-2" &&
      eur2.provider_template === "tpl_1" &&
      eur2.observed_state === "starting" &&
      sandboxOf("eur-2").length === 1 &&
      events("provisioned", "boat").length === 1,
    { row: eur2, sandboxes: sandboxes(), provisioned: events("provisioned") },
  );
  const alertsAbout = (text: string) => alerts.filter((alert) => alert.includes(text));
  check(
    "a start on boat alerts the operator once, with the plan, the currency, the server and the reason",
    alertsAbout("eur-2").length === 1 &&
      alertsAbout("eur-2")[0] === "A standard server (eur, eur-2) starts on boat: no ready VPS02 in AMS-01.",
    alerts,
  );
  check(
    "a purchase that takes the last free machine of its group alerts the operator",
    alertsAbout("Pool WDC-02 VPS02: 0 free machines left.").length === 1,
    alerts,
  );
  const serversOn = (hostId: string) =>
    database.prepare("SELECT server_id FROM hosted_servers WHERE operator_host = ?").all(hostId);
  check(
    "a machine of another product, a machine with an old or no poll, with no token, removed, or with a server gets no new server",
    serversOn(amsPro).length === 0 &&
      serversOn(stale).length === 0 &&
      serversOn(neverSeen).length === 0 &&
      serversOn(noToken).length === 0 &&
      serversOn(removed).length === 0 &&
      serversOn(taken).length === 1,
    [amsPro, stale, neverSeen, noToken, removed, taken].map((hostId) => ({ hostId, servers: serversOn(hostId) })),
  );

  // 3. The other location is used when the preferred one has no machine.
  await purchase("usd-2", "pro", "usd");
  check(
    "a US dollar purchase uses a ready machine in AMS-01 when WDC-02 has none",
    row("usd-2")?.operator_host === amsPro && sandboxOf("usd-2").length === 0,
    row("usd-2"),
  );

  // A purchase in euros stays in the EU: it does not use the machine in WDC-02, and no purchase uses a
  // machine in a location that the privacy notice does not name.
  const wdcPro = await machine(1012, "VPS03", "WDC-02");
  const sydPro = await machine(1013, "VPS03", "SYD-12");
  await purchase("eur-pro", "pro", "eur");
  await purchase("usd-pro", "pro", "usd");
  await purchase("usd-pro-2", "pro", "usd");
  check(
    "a euro purchase does not start in WDC-02, and no purchase starts in a location outside the list",
    row("eur-pro")?.operator_host === null &&
      sandboxOf("eur-pro").length === 1 &&
      row("usd-pro")?.operator_host === wdcPro &&
      row("usd-pro-2")?.operator_host === null &&
      sandboxOf("usd-pro-2").length === 1 &&
      serversOn(sydPro).length === 0,
    { eur: row("eur-pro"), usd: row("usd-pro"), usd2: row("usd-pro-2") },
  );

  // 4. Two purchases at the same moment and one machine.
  const starter = await machine(1009, "VPS01", "AMS-01");
  await Promise.all([purchase("starter-1", "starter", "eur"), purchase("starter-2", "starter", "eur")]);
  const onStarter = serversOn(starter).length;
  check(
    "two purchases at the same moment never get one machine: one starts there, and one on boat",
    onStarter === 1 && sandboxOf("starter-1").length + sandboxOf("starter-2").length === 1,
    { machine: serversOn(starter), sandboxes: sandboxes() },
  );
  // A boat `small` sandbox has less disk than the Starter storage. Its VPS 1 keeps the plan size.
  const starterOnBoat = [...sandboxOf("starter-1"), ...sandboxOf("starter-2")][0];
  const starters = (await Effect.runPromise(service.list(OWNER))).servers.filter((server) =>
    server.serverId.startsWith("starter-"),
  );
  check(
    "a Starter on boat gets a `default` sandbox, a Starter on its VPS 1 stays `small`, and both have 25 GB",
    starterOnBoat?.type === "default" &&
      starters.length === 2 &&
      starters.every(
        (server) =>
          server.size === (server.serverId === starterOnBoat.serverId ? "default" : "small") && server.storageGb === 25,
      ),
    {
      sandboxes: sandboxes(),
      starters: starters.map(({ serverId, size, storageGb }) => ({ serverId, size, storageGb })),
    },
  );

  // A Starter that waits for its payment has no machine yet. Its `small` row size is not a boat disk.
  insertServer.run(
    "starter-unpaid",
    OWNER.id,
    "Server starter-unpaid",
    null,
    null,
    HOSTED_PLAN_SIZE.starter,
    "starter",
    "eur",
    "awaiting_payment",
    "key-starter-unpaid",
    clock.now,
    clock.now,
  );
  const unpaid = (await Effect.runPromise(service.list(OWNER))).servers.find(
    (server) => server.serverId === "starter-unpaid",
  );
  check("a Starter with no machine yet shows the plan storage of 25 GB", unpaid?.storageGb === 25, { unpaid });

  // 5. A server with an earlier boat attempt stays on boat: boat can still make the sandbox of that attempt.
  const spare = await machine(1010, "VPS02", "AMS-01");
  await purchase("retry", "standard", "eur", "tpl_old");
  check(
    "a server with a boat attempt stays on boat with the template of that attempt, and the machine stays free",
    row("retry")?.operator_host === null && sandboxOf("retry")[0]?.from === "tpl_old" && serversOn(spare).length === 0,
    { row: row("retry"), sandboxes: sandboxes() },
  );

  // 6. The machine asks for its server.
  const wrongToken = randomToken();
  const refused = {
    wrongToken: await refusal(service.poolAssignment(wdcStandard, wrongToken)),
    tokenOfAnotherMachine: await refusal(service.poolAssignment(wdcStandard, tokens.get(amsStandard))),
    shortToken: await refusal(service.poolAssignment(wdcStandard, "short")),
    noToken: await refusal(service.poolAssignment(noToken, tokens.get(noToken))),
    removed: await refusal(service.poolAssignment(removed, tokens.get(removed))),
    unknownMachine: await refusal(service.poolAssignment("leaseweb:9999", wrongToken)),
    notAMachine: await refusal(service.poolAssignment("bx_1", wrongToken)),
    noBody: await refusal(service.poolAssignment(undefined, undefined)),
  };
  check(
    "a wrong token, the token of another machine, a removed or unknown machine and a bad body get 401",
    Object.values(refused).every((entry) => entry?.status === 401 && entry.code === "hosted_pool_token_invalid"),
    refused,
  );
  clock.now = t0 + 30 * SECOND;
  const free = await poll(spare);
  const seenEarly = machineRow(spare)?.seen_at;
  clock.now = t0 + 61 * SECOND;
  await poll(spare);
  const seenLate = machineRow(spare)?.seen_at;
  check(
    "a free machine gets `waiting`, and its poll time is stored at most one time each minute",
    free.state === "waiting" && seenEarly === t0 && seenLate === t0 + 61 * SECOND,
    { free, seenEarly, seenLate },
  );
  clock.now = t0 + 20 * SECOND;
  const first = await poll(wdcStandard);
  const second = await poll(wdcStandard);
  check(
    "the machine of a new server gets the server ID and a claim, and the same claim again after a crash",
    first.state === "assigned" &&
      second.state === "assigned" &&
      first.serverId === "usd-1" &&
      first.claim === second.claim &&
      /^[A-Za-z0-9_-]{32,128}$/u.test(first.claim),
    { state: first.state, serverId: first.state === "assigned" ? first.serverId : null },
  );
  const otherClaim = await poll(amsStandard);
  check(
    "each machine gets only its own server, with a different claim",
    otherClaim.state === "assigned" &&
      first.state === "assigned" &&
      otherClaim.serverId === "eur-1" &&
      otherClaim.claim !== first.claim,
    { state: otherClaim.state },
  );

  // 7. OpenBot on the machine signs in with the claim.
  clock.now = t0 + 35 * SECOND;
  const session = first.state === "assigned" ? await Effect.runPromise(service.redeemClaim(first.claim)) : null;
  const signedIn = row("usd-1");
  check(
    "the sign-in of OpenBot sets the server to running on its machine",
    session?.hostId === "usd-1" &&
      session.user.id === OWNER.id &&
      signedIn?.observed_state === "running" &&
      signedIn.operator_host === wdcStandard &&
      signedIn.claim_redeemed_at === t0 + 35 * SECOND &&
      signedIn.start_requested_at === null,
    signedIn,
  );
  const ready = events("ready");
  check(
    "the sign-in sends one ready event: the machine `pool`, the reason `create`, and the time from the assignment",
    ready.length === 1 &&
      ready[0]?.machine === "pool" &&
      ready[0].reason === "create" &&
      ready[0].durationMs === 35 * SECOND &&
      ready[0].plan === "standard",
    ready,
  );
  check(
    "the machine with a signed-in server has no token: its next poll gets 401, and the machine stops",
    machineRow(wdcStandard)?.assign_token_hash === null &&
      (await refusal(service.poolAssignment(wdcStandard, tokens.get(wdcStandard))))?.status === 401,
    machineRow(wdcStandard),
  );
  clock.now = t0 + 40 * SECOND;
  const again = first.state === "assigned" ? await refusal(service.redeemClaim(first.claim)) : null;
  check(
    "a second sign-in in the retry time works and sends no second ready event",
    again === null && events("ready").length === 1 && row("usd-1")?.observed_state === "running",
    { again, ready: events("ready") },
  );

  check(
    "a retry of an earlier boat attempt sends no alert: it never asks the pool",
    alertsAbout("(eur, retry)").length === 0,
    alerts,
  );

  // 8. OpenBot on the machines of `eur-1`, `usd-2`, `usd-pro` and one Starter server never signs in. The
  // cron moves each server to boat.
  const unsigned = ["eur-1", "usd-2", "usd-pro", serversOn(starter)[0]?.server_id].map(String);
  const boatBefore = events("provisioned", "boat").length;
  const alertsBefore = alerts.length;
  const before = await tick(t0 + 3 * MINUTE);
  check(
    "the cron keeps a pool start that is younger than the limit",
    row("eur-1")?.operator_host === amsStandard && sandboxOf("eur-1").length === 0 && before.provisioned === 0,
    { row: row("eur-1"), result: before },
  );
  const after = await tick(t0 + 5 * MINUTE);
  const left = unsigned.map((serverId) => ({ serverId, row: row(serverId) }));
  check(
    "after the limit each server with no sign-in leaves its machine and starts in a boat sandbox",
    left.every(
      (entry) =>
        entry.row?.operator_host === null &&
        entry.row.provider_sandbox_id === `bx_${entry.serverId}` &&
        entry.row.provider_template === "tpl_1" &&
        entry.row.observed_state === "starting" &&
        sandboxOf(entry.serverId).length === 1,
    ) && after.provisioned === unsigned.length,
    { rows: left, result: after },
  );
  check(
    "each lost pool start sends setup_failed with the machine `pool`, then provisioned with the machine `boat`",
    events("setup_failed", "pool").length === unsigned.length &&
      events("setup_failed", "pool").every((event) => event.error === "start_failed") &&
      events("setup_failed", "boat").length === 0 &&
      events("provisioned", "boat").length === boatBefore + unsigned.length,
    { failed: events("setup_failed"), provisioned: events("provisioned", "boat") },
  );
  check(
    "each lost pool start alerts once with its machine, and once more when its boat start is stored",
    alerts.length === alertsBefore + 2 * unsigned.length &&
      unsigned.every(
        (serverId) =>
          alertsAbout(`(${serverId.slice(0, 8)}) did not start on pool machine`).length === 1 &&
          alerts
            .slice(alertsBefore)
            .filter((alert) => alert.includes(`${serverId.slice(0, 8)}) starts on boat: pool machine`)).length === 1,
      ),
    alerts.slice(alertsBefore),
  );
  check(
    "no alert names the owner",
    alerts.length > 0 && alerts.every((alert) => !alert.includes(OWNER.email) && !alert.includes(OWNER.id)),
    alerts,
  );
  check(
    "the machine that lost its server has no token, and the old pool claim signs nothing in",
    machineRow(amsStandard)?.assign_token_hash === null &&
      (await refusal(service.poolAssignment(amsStandard, tokens.get(amsStandard))))?.status === 401 &&
      otherClaim.state === "assigned" &&
      (await refusal(service.redeemClaim(otherClaim.claim)))?.code === "hosted_claim_invalid" &&
      sandboxOf("eur-1")[0]?.claim !== otherClaim.claim,
    machineRow(amsStandard),
  );
  check(
    "the cron changes no other pool server: the signed-in server keeps its machine and gets no boat sandbox",
    row("usd-1")?.operator_host === wdcStandard &&
      row("usd-1")?.observed_state === "running" &&
      sandboxOf("usd-1").length === 0 &&
      row("moved")?.operator_host === taken,
    { usd1: row("usd-1"), moved: row("moved") },
  );

  // 9. The machine that lost a server gets no other server. The next purchase takes the spare machine.
  clock.now = t0 + 5 * MINUTE;
  await poll(spare);
  await purchase("eur-3", "standard", "eur");
  check(
    "the next purchase takes the other ready machine, not the machine that lost a server",
    row("eur-3")?.operator_host === spare && serversOn(amsStandard).length === 0,
    row("eur-3"),
  );

  // 10. The owner deletes the server before OpenBot signs in.
  database.prepare("UPDATE billing_subscriptions SET status = 'canceled' WHERE server_id = 'eur-3'").run();
  await Effect.runPromise(service.delete(OWNER, "eur-3", "Server eur-3"));
  await Promise.all(work.splice(0));
  const deleted = row("eur-3");
  const afterDelete = await poll(spare);
  await purchase("eur-4", "standard", "eur");
  await tick(t0 + 15 * MINUTE);
  check(
    "a server deleted during its pool start keeps the name of the machine for the operator, and the machine gets no claim and no other server",
    deleted?.desired_state === "deleted" &&
      deleted.operator_host === spare &&
      afterDelete.state === "waiting" &&
      row("eur-4")?.operator_host === null &&
      sandboxOf("eur-4").length === 1 &&
      row("eur-3")?.operator_host === spare &&
      sandboxOf("eur-3").length === 0,
    { deleted, afterDelete, next: row("eur-4"), later: row("eur-3") },
  );

  // 11. The plan ends before OpenBot signs in: the machine is released, and no boat sandbox is made.
  const lapsing = await machine(1011, "VPS02", "AMS-01");
  await purchase("lapsed", "standard", "eur");
  const lapsedAt = clock.now;
  database.prepare("UPDATE billing_subscriptions SET status = 'canceled' WHERE server_id = 'lapsed'").run();
  await Effect.runPromise(
    service.onSubscriptionSynced({
      subscriptionId: "sub_lapsed",
      userId: OWNER.id,
      serverId: "lapsed",
      status: "canceled",
      plan: "standard",
      interval: "month",
      currency: "eur",
    }),
  );
  await Promise.all(work.splice(0));
  const ended = row("lapsed");
  const endedPoll = await poll(lapsing);
  await tick(lapsedAt + 5 * MINUTE);
  const released = row("lapsed");
  check(
    "a server whose plan ended before the sign-in gets no claim, leaves its machine, and gets no boat sandbox",
    ended?.operator_host === lapsing &&
      ended.desired_state === "stopped" &&
      endedPoll.state === "waiting" &&
      released?.operator_host === null &&
      released.observed_state === "error" &&
      released.desired_state === "stopped" &&
      sandboxOf("lapsed").length === 0 &&
      machineRow(lapsing)?.assign_token_hash === null &&
      alerts.at(-1) ===
        `A standard server (lapsed) did not start on pool machine ${lapsing}. Prepare the machine again.`,
    { ended, endedPoll, released, machine: machineRow(lapsing), alert: alerts.at(-1) },
  );
}

async function openPanelBodyHasTheMachine() {
  const bodies: unknown[] = [];
  const work: Promise<void>[] = [];
  const analytics = createAccountAnalytics({
    clientId: "client",
    clientSecret: "secret",
    fetch: async (_input, init) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 202 });
    },
    schedule: (send) => work.push(Effect.runPromise(send)),
    database: sqliteD1(migratedDatabase()),
  });
  analytics.track("owner", {
    name: "hosted_server_action",
    action: "ready",
    plan: "standard",
    size: "default",
    reason: "create",
    durationMs: 35_000,
    machine: "pool",
  });
  analytics.track("owner", { name: "hosted_server_action", action: "provisioned", plan: "pro", machine: "boat" });
  await Promise.all(work);
  const properties = bodies.map((body) =>
    isDynamicRecord(body) && isDynamicRecord(body.payload) && isDynamicRecord(body.payload.properties)
      ? body.payload.properties
      : null,
  );
  check(
    "the OpenPanel bodies have the machine and the generation",
    properties[0]?.machine === "pool" &&
      properties[0]?.duration_ms === 35_000 &&
      properties[1]?.machine === "boat" &&
      properties[0]?.event_schema_version === ACCOUNT_ANALYTICS_SCHEMA_VERSION &&
      ACCOUNT_ANALYTICS_SCHEMA_VERSION >= 17,
    properties,
  );
}

let passed = false;
try {
  await purchaseStartsOnThePoolOrOnBoat();
  await openPanelBodyHasTheMachine();
  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) console.log(`${item.passed ? "ok  " : "FAIL"} ${item.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exit(1);
