import { type ChildProcess, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { MessagingPlatform } from "@openbot/contracts/ipc";
import { SLACK_EVENTS_PATH } from "@openbot/contracts/signal-protocol/slack-route";
import { TELEGRAM_UPDATES_PATH } from "@openbot/contracts/signal-protocol/telegram-route";
import {
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_EVENTS_PATH,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "@openbot/contracts/signal-protocol/webhook-route";
import { Effect, Schema } from "effect";
import { CentralAuthManager } from "../src/main/central-auth-manager";
import { RemoteWorkflowError, toRemoteWorkflowError } from "../src/main/remote-service-effects";
import { SignalIngress } from "../src/main/signal-ingress";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "ingress-combined-tickets-e2e");
const BOT_ID = "777000222";
const SLACK_APP_ID = "A0INGRESS1";
const SLACK_SIGNING_SECRET = randomBytes(24).toString("base64url");
const TELEGRAM_WEBHOOK_SECRET = randomBytes(32).toString("base64url");
const WAIT_MS = 20_000;
const SIGNAL_START_WINDOW_MS = 6_000;
const QUIET_MS = 8_000;

interface Check {
  name: string;
  passed: boolean;
  detail?: unknown;
}

const ShimStats = Schema.Struct({
  requests: Schema.Array(Schema.String),
  d1: Schema.Struct({ roundTrips: Schema.Number, statements: Schema.Number, batches: Schema.Number }),
});
type ShimStats = typeof ShimStats.Type;
const decodeStats = Schema.decodeUnknownSync(Schema.fromJsonString(ShimStats));
const SeededRoutes = Schema.Struct({
  slackTeamId: Schema.String,
  telegramChatId: Schema.String,
  webhookRouteId: Schema.String,
});
type SeededRoutes = typeof SeededRoutes.Type;
const decodeSeeded = Schema.decodeUnknownSync(Schema.fromJsonString(SeededRoutes));

interface ShimRequest {
  hostId?: string;
  machineToken?: string;
  combined?: boolean;
  telegram?: boolean;
  failWebhook?: number;
}

const checks: Check[] = [];
const check = (name: string, passed: boolean, detail?: unknown) =>
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address ? resolvePort(address.port) : reject(new Error("No port.")),
      );
    });
  });
}

async function waitFor(condition: () => boolean | Promise<boolean>, label: string, timeoutMs = WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}.`);
    await Bun.sleep(25);
  }
}

const output: string[] = [];
const children: ChildProcess[] = [];

function start(command: string, env: Record<string, string>, cwd = ROOT): ChildProcess {
  const child = spawn("bun", [command], {
    cwd,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  children.push(child);
  return child;
}

const botApi = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () =>
    Response.json({ ok: true, result: { id: Number(BOT_ID), is_bot: true, username: "ingress_bot", message_id: 1 } }),
});

const [signalPort, healthPort] = await Promise.all([freePort(), freePort()]);
const signalUrl = `ws://127.0.0.1:${signalPort}/v1/signal`;
const shim = start(resolve(ROOT, "apps/auth-api/scripts/ingress-tickets-worker.ts"), {
  INGRESS_E2E_SIGNAL_URL: signalUrl,
  INGRESS_E2E_TELEGRAM_BOT_ID: BOT_ID,
});
const shimReady = await new Promise<{ port: number; publicJwk: unknown }>((resolveReady, reject) => {
  if (!shim.stdout) return reject(new Error("No shim output."));
  const lines = createInterface({ input: shim.stdout });
  lines.once("line", (line) => resolveReady(JSON.parse(line)));
  shim.once("exit", (code) => reject(new Error(`The Worker shim exited with code ${code}.`)));
});
const accountUrl = `http://127.0.0.1:${shimReady.port}`;
const shimCall = async (path: string, body: ShimRequest = {}) =>
  (await fetch(`${accountUrl}${path}`, { method: "POST", body: JSON.stringify(body) })).text();
const stats = async () => decodeStats(await shimCall("/__stats"));
const resetStats = () => shimCall("/__reset");
const setMode = (mode: ShimRequest) => shimCall("/__mode", mode);

start(
  resolve(ROOT, "remote/api/src/index.ts"),
  {
    REMOTE_SIGNAL_HOST: "127.0.0.1",
    REMOTE_SIGNAL_PORT: String(signalPort),
    REMOTE_HEALTH_PORT: String(healthPort),
    REMOTE_TLS_DISABLED: "true",
    REMOTE_TICKET_PUBLIC_KEYS: JSON.stringify({ keys: [shimReady.publicJwk] }),
    REMOTE_CONTROL_PLANE_URL: accountUrl,
    REMOTE_SESSION_SECRET: randomBytes(32).toString("base64url"),
    REMOTE_AUTH_WEBHOOK_SECRET: randomBytes(32).toString("base64url"),
    TURN_SHARED_SECRET: randomBytes(32).toString("base64url"),
    TURN_HOST: "127.0.0.1",
    TURN_PORT: String(await freePort()),
    SIGNAL_ID: "a",
    TELEGRAM_BOT_TOKENS: `${BOT_ID}:${randomBytes(24).toString("base64url")}`,
    TELEGRAM_WEBHOOK_SECRET,
    SLACK_SIGNING_SECRET: `${SLACK_APP_ID}:${SLACK_SIGNING_SECRET}`,
    TELEGRAM_TEST_API_ORIGIN: `http://127.0.0.1:${botApi.port}`,
  },
  resolve(ROOT, "remote/api"),
);
await waitFor(
  () =>
    fetch(`http://127.0.0.1:${signalPort}/health/ready`).then(
      (response) => response.ok,
      () => false,
    ),
  "Signal ready",
  30_000,
);
await Bun.sleep(SIGNAL_START_WINDOW_MS);

const sessionRoot = mkdtempSync(join(tmpdir(), "ingress-combined-"));

interface Probe {
  ingress: SignalIngress;
  seeded: Promise<SeededRoutes>;
  delivered: string[];
  connects: () => number;
  reconnectsAfterOnline: () => number;
  states: string[];
  release: () => void;
}

function probe(hostId: string, platforms: readonly MessagingPlatform[], webhooks: boolean): Probe {
  const machineToken = randomBytes(24).toString("base64url");
  const centralAuth = new CentralAuthManager({
    apiUrl: accountUrl,
    storagePath: join(sessionRoot, `${hostId}.bin`),
    encrypt: (value) => Buffer.from(value),
    decrypt: (value) => value.toString(),
  });
  centralAuth.useHostCredential(hostId, machineToken);
  const pending = shimCall("/__host", { hostId, machineToken }).then(decodeSeeded);
  const ingress = new SignalIngress({
    hostId: () => hostId,
    signedIn: () => true,
    issueTicket: (id) => centralAuth.issueRemoteHostTicket(id).pipe(toRemoteWorkflowError),
    issueSlackRoute: (id) => centralAuth.issueSlackRoute(id).pipe(toRemoteWorkflowError),
    issueDiscordRoute: (id) => centralAuth.issueDiscordRoute(id).pipe(toRemoteWorkflowError),
    issueWebhookRoute: (id) => centralAuth.issueWebhookRoute(id).pipe(toRemoteWorkflowError),
    issueTelegramRoute: (id) => centralAuth.issueTelegramRoute(id).pipe(toRemoteWorkflowError),
    issueIngressTickets: (id, routes) => centralAuth.issueIngressTickets(id, routes).pipe(toRemoteWorkflowError),
    issueGitHubRoute: () => Effect.fail(new RemoteWorkflowError({ cause: new Error("GitHub is not used.") })),
  });
  const states: string[] = [];
  const delivered: string[] = [];
  ingress.onState((state) => states.push(state));
  ingress.handle((workspaceId, delivery) =>
    Effect.sync(() => {
      delivered.push(`${delivery.platform}:${workspaceId}`);
      return { status: 200 as const };
    }),
  );
  ingress.handleWebhooks((delivery) =>
    Effect.sync(() => {
      delivered.push(`webhook:${delivery.routeId}`);
      return { status: 202 as const };
    }),
  );
  let releases: (() => void)[] = [];
  const hold = () => {
    releases = [
      ...platforms.map((platform) => ingress.acquire(platform)),
      ...(webhooks ? [ingress.acquireWebhooks()] : []),
    ];
  };
  void pending.then(hold);
  return {
    ingress,
    seeded: pending,
    delivered,
    states,
    connects: () => states.filter((state) => state === "connecting").length,
    reconnectsAfterOnline: () => {
      const online = states.indexOf("online");
      return online < 0 ? 0 : states.slice(online).filter((state) => state === "connecting").length;
    },
    release: () => {
      for (const release of releases) release();
    },
  };
}

async function finish(entry: Probe) {
  entry.release();
  await Effect.runPromise(entry.ingress.dispose());
}

const signalHttp = `http://127.0.0.1:${signalPort}`;

async function deliverThroughSignal(entry: Probe) {
  const seeded = await entry.seeded;
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const slackBody = JSON.stringify({
    type: "event_callback",
    api_app_id: SLACK_APP_ID,
    team_id: seeded.slackTeamId,
    event: { type: "app_mention", user: "U0SENDER", channel: "C0INGRESS", text: "ping", ts: "1.000001" },
  });
  const slackSignature = createHmac("sha256", SLACK_SIGNING_SECRET)
    .update(`v0:${timestamp}:${slackBody}`)
    .digest("hex");
  const slack = await fetch(`${signalHttp}${SLACK_EVENTS_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": `v0=${slackSignature}`,
    },
    body: slackBody,
  });
  const telegramSecret = createHmac("sha256", TELEGRAM_WEBHOOK_SECRET)
    .update(`telegram-webhook:${BOT_ID}`)
    .digest("base64url");
  const telegram = await fetch(`${signalHttp}${TELEGRAM_UPDATES_PATH}/${BOT_ID}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": telegramSecret },
    body: JSON.stringify({
      update_id: 1,
      message: { message_id: 1, chat: { id: Number(seeded.telegramChatId), type: "supergroup" }, text: "ping" },
    }),
  });
  const webhook = await fetch(`${signalHttp}${WEBHOOK_EVENTS_PATH}/${seeded.webhookRouteId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
      [WEBHOOK_DELIVERY_ID_HEADER]: `delivery-${timestamp}`,
      [WEBHOOK_SIGNATURE_HEADER]: `sha256=${"0".repeat(64)}`,
    },
    body: JSON.stringify({ ping: true }),
  });
  const expected = [
    `slack:${seeded.slackTeamId}`,
    `telegram:${seeded.telegramChatId}`,
    `webhook:${seeded.webhookRouteId}`,
  ];
  await waitFor(() => expected.every((key) => entry.delivered.includes(key)), "deliveries through Signal", 5_000).catch(
    () => undefined,
  );
  return {
    status: { slack: slack.status, telegram: telegram.status, webhook: webhook.status },
    expected,
    delivered: [...entry.delivered],
    passed: expected.every((key) => entry.delivered.includes(key)),
  };
}

const ingressPath = (request: string) => request.replace(/^\/v2\/remote\/hosts\/[^/]+\//u, "");
const ALL: readonly MessagingPlatform[] = ["slack", "discord", "telegram"];
interface OpenScenario {
  firstOpens: { starts: number; requests: string[]; d1: ShimStats["d1"] };
  laterOpen: { requests: string[]; d1: ShimStats["d1"] };
  deliveries: Awaited<ReturnType<typeof deliverThroughSignal>>;
}

interface HeldScenario {
  requests: string[];
  reconnectsAfterOnline: number;
  states: string[];
  webhookAtOnline?: boolean;
  requestsAtOnline?: number;
  quietMs?: number;
}

const scenarios: Record<string, OpenScenario | HeldScenario> = {};
const laterOpens: { before?: ShimStats; after?: ShimStats } = {};

async function openCost(label: string, combined: boolean) {
  await setMode({ combined, telegram: true, failWebhook: 0 });
  await resetStats();
  const entry = probe(`host-${label}`, ALL, true);
  await waitFor(() => entry.ingress.state() === "online" && entry.ingress.webhookReady(), `${label} first open`);
  const first = await stats();
  const firstConnects = entry.connects();
  await resetStats();
  entry.ingress.reconnect();
  await waitFor(
    () => entry.connects() > firstConnects && entry.ingress.state() === "online" && entry.ingress.webhookReady(),
    `${label} second open`,
  );
  const second = await stats();
  const deliveries = await deliverThroughSignal(entry);
  await finish(entry);
  return { first, firstConnects, second, deliveries };
}

try {
  const legacy = await openCost("legacy", false);
  laterOpens.before = legacy.second;
  scenarios.legacyWorker = {
    firstOpens: {
      starts: legacy.firstConnects,
      requests: legacy.first.requests.map(ingressPath),
      d1: legacy.first.d1,
    },
    laterOpen: { requests: legacy.second.requests.map(ingressPath), d1: legacy.second.d1 },
    deliveries: legacy.deliveries,
  };
  const legacyProbes = legacy.first.requests.filter((path) => path.includes("ingress-tickets")).length;
  check(
    "an old Worker: each open that starts before the first 404 asks for the combined route once, then falls back",
    legacyProbes >= 1 &&
      legacyProbes <= legacy.firstConnects &&
      legacy.first.requests.some((path) => path.endsWith("/ticket")),
    { starts: legacy.firstConnects, requests: legacy.first.requests.map(ingressPath) },
  );
  check(
    "an old Worker: the host remembers the fallback and does not ask for the combined route again",
    legacy.second.requests.every((path) => !path.includes("ingress-tickets")) && legacy.second.requests.length === 5,
    legacy.second.requests.map(ingressPath),
  );

  const combined = await openCost("combined", true);
  laterOpens.after = combined.second;
  scenarios.combinedWorker = {
    firstOpens: {
      starts: combined.firstConnects,
      requests: combined.first.requests.map(ingressPath),
      d1: combined.first.d1,
    },
    laterOpen: { requests: combined.second.requests.map(ingressPath), d1: combined.second.d1 },
    deliveries: combined.deliveries,
  };
  check(
    "a new Worker: each open makes one account request",
    combined.first.requests.length === combined.firstConnects &&
      combined.first.requests.every((path) => path.includes("ingress-tickets")) &&
      combined.second.requests.length === 1,
    {
      starts: combined.firstConnects,
      first: combined.first.requests.map(ingressPath),
      later: combined.second.requests.map(ingressPath),
    },
  );
  check(
    "a new Worker: each open makes one D1 batch for all route tables",
    combined.first.d1.batches === combined.firstConnects && combined.second.d1.batches === 1,
    { starts: combined.firstConnects, first: combined.first.d1, later: combined.second.d1 },
  );
  check(
    "a new Worker: an open makes fewer D1 round trips than on an old Worker",
    combined.second.d1.roundTrips < legacy.second.d1.roundTrips,
    { old: legacy.second.d1, new: combined.second.d1 },
  );
  check(
    "an old Worker: Signal delivers Slack, Telegram and webhook events on the separate tickets",
    legacy.deliveries.passed,
    legacy.deliveries,
  );
  check(
    "a new Worker: Signal accepts the combined tickets and delivers Slack, Telegram and webhook events",
    combined.deliveries.passed,
    combined.deliveries,
  );

  for (const [label, combinedRoute] of [
    ["missing-new-worker", true],
    ["missing-old-worker", false],
  ] as const) {
    await setMode({ combined: combinedRoute, telegram: true, failWebhook: 1 });
    await resetStats();
    const entry = probe(`host-${label}`, ["slack"], true);
    await waitFor(() => entry.ingress.state() === "online", `${label} online`);
    const webhookAtOnline = entry.ingress.webhookReady();
    await waitFor(() => entry.ingress.webhookReady(), `${label} webhook added`);
    const requests = (await stats()).requests.map(ingressPath);
    const result = {
      requests,
      reconnectsAfterOnline: entry.reconnectsAfterOnline(),
      states: [...entry.states],
      webhookAtOnline,
    };
    scenarios[label] = result;
    check(
      `${label}: a missing webhook route is added on the open socket, with no reconnect`,
      !webhookAtOnline && result.reconnectsAfterOnline === 0 && entry.ingress.state() === "online",
      result,
    );
    await finish(entry);
  }

  for (const [label, combinedRoute] of [
    ["telegram-off-new-worker", true],
    ["telegram-off-old-worker", false],
  ] as const) {
    await setMode({ combined: combinedRoute, telegram: false, failWebhook: 0 });
    await resetStats();
    const entry = probe(`host-${label}`, ["telegram"], true);
    await waitFor(() => entry.ingress.state() === "online" && entry.ingress.webhookReady(), `${label} online`);
    const afterOpen = (await stats()).requests.length;
    await Bun.sleep(QUIET_MS);
    const requests = (await stats()).requests.map(ingressPath);
    const result = {
      requests,
      requestsAtOnline: afterOpen,
      reconnectsAfterOnline: entry.reconnectsAfterOnline(),
      states: [...entry.states],
      quietMs: QUIET_MS,
    };
    scenarios[label] = result;
    check(
      `${label}: Telegram not configured on the Worker causes no reconnect and no new request`,
      result.reconnectsAfterOnline === 0 && requests.length === afterOpen && entry.ingress.state() === "online",
      result,
    );
    await finish(entry);
  }
} catch (error) {
  check("the scenarios ran to the end", false, error instanceof Error ? error.message : String(error));
} finally {
  for (const child of children) child.kill("SIGTERM");
  botApi.stop(true);
  rmSync(sessionRoot, { recursive: true, force: true });
}

const legacyLater = laterOpens.before;
const combinedLater = laterOpens.after;
const report = {
  generatedAt: new Date().toISOString(),
  perOpen: {
    before: legacyLater ? { accountRequests: legacyLater.requests.length, d1: legacyLater.d1 } : null,
    after: combinedLater ? { accountRequests: combinedLater.requests.length, d1: combinedLater.d1 } : null,
  },
  scenarios,
  checks,
  passed: checks.length > 0 && checks.every((entry) => entry.passed),
  ...(checks.every((entry) => entry.passed) ? {} : { serviceOutput: output.join("").slice(-8_000) }),
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const entry of checks) process.stdout.write(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}\n`);
process.stdout.write(`${JSON.stringify(report.perOpen)}\n`);
process.exit(report.passed ? 0 : 1);
