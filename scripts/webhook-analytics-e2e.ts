// Checks the webhook analytics of the host: one `system_webhook_delivery` for each inbound request,
// and `system_routine_run` with `trigger_type: webhook` and `run_source: webhook` for the run that a
// request starts. Runs the real agent service, events service and host analytics on a temporary
// profile with a fake Codex app-server, a fake relay and a capture OpenPanel client.
// The check sends signed and refused requests and a test event, and asserts the result, status,
// owner kind, format and timings of each event; that no event has a route ID, a delivery ID, a
// secret, a routine name or body text; and that at most 60 delivery events go each minute, the next
// one with the count of those that did not go. The minute is moved forward through `Date.now`.
// It also checks that the renderer gives `webhook_route_limit` for the host's route limit failure.
// `bun scripts/webhook-analytics-e2e.ts`. Writes .openbot-build/webhook-analytics-e2e/report.json.
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { WEBHOOK_DELIVERY_BODY_BYTES_LIMIT } from "@openbot/contracts/signal-protocol/messages";
import { WEBHOOK_ROUTES_LIMIT } from "@openbot/contracts/signal-protocol/webhook-route";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { HostOpenPanelClient } from "../src/main/analytics";

const OUT = resolve(import.meta.dirname, "../.openbot-build/webhook-analytics-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-webhook-analytics-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { HostAnalytics } = await import("../src/main/analytics");
const { agentWebhookRoutineWriter, HostEventsService } = await import("../src/main/host-events-service");
const { webhookFailureCode } = await import("../src/renderer/src/webhook-failure-code");

const RELAY_ORIGIN = "https://signal.example.test";
const ROUTINE_NAME = "Failed builds webhook";
const BODY_MARK = "secret-build-log-text";

/** A Codex app-server with the methods that the service calls. Each turn answers "Done.". */
const FAKE_CODEX = `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-6-luna", displayName: "GPT-6 Luna" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + (++turns);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      return setTimeout(() => {
        const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
      }, 20);
    }
    case "turn/interrupt": {
      write({ id: message.id, result: {} });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

type Properties = NonNullable<Parameters<HostOpenPanelClient["track"]>[1]>;
interface Sent {
  name: string;
  properties: Properties;
}

const report: {
  statuses: Record<string, number>;
  deliveries: Properties[];
  routineRuns: Properties[];
  cap?: { sentInWindow: number; skippedCount: unknown };
  routeLimitCode?: string;
  checks: { name: string; passed: boolean }[];
  passed: boolean;
  error?: string;
} = { statuses: {}, deliveries: [], routineRuns: [], checks: [], passed: false };

const sent: Sent[] = [];
const client: HostOpenPanelClient = {
  setGlobalProperties: () => {},
  identify: async () => {},
  clear: () => {},
  track: async (name, properties) => {
    sent.push({ name, properties: { ...properties } });
  },
};
const deliveries = () => sent.filter((event) => event.name === "system_webhook_delivery").map((e) => e.properties);
const routineRuns = () => sent.filter((event) => event.name === "system_routine_run").map((e) => e.properties);

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

/** Waits for a state of the service or of the capture client. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function pass(name: string, condition: boolean, detail?: unknown) {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail === undefined ? name : `${name}: ${JSON.stringify(detail)}`);
}

// `profileId` is the account that the analytics service sends each event for.
const DELIVERY_KEYS = new Set([
  "profileId",
  "owner_kind",
  "format",
  "result",
  "ignored_reason",
  "status_code",
  "body_bytes",
  "handle_ms",
  "delivery_age_ms",
  "test",
  "skipped_count",
]);

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
let principal: string | null = "account-1";
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  // As in the app: the events service is built after the agent service.
  webhookRoutines: () => agentWebhookRoutineWriter(events),
});
// As in the app: the analytics service is built after the events service, so the report is bound late.
let reportDelivery:
  | ((report: Parameters<InstanceType<typeof HostAnalytics>["handleWebhookDelivery"]>[0]) => void)
  | null = null;
const events = new HostEventsService({
  routines: agents.routineRecords,
  cipher: {
    encrypt: (value) => Buffer.from(`sealed:${Buffer.from(value).toString("base64")}`),
    decrypt: (value) => Buffer.from(value.toString().slice("sealed:".length), "base64").toString(),
  },
  relay: {
    connected: () => true,
    setEnabled: () => {},
    setAccountActive: () => {},
    refresh: () => {},
    registerRoute: (routeId) => Effect.succeed(`${RELAY_ORIGIN}/v1/webhooks/${routeId}`),
    revokeRoute: () => Effect.void,
  },
  accountPrincipal: () => principal,
  onDelivery: (delivery) => reportDelivery?.(delivery),
});
const analytics = new HostAnalytics(
  {
    enabled: true,
    trackingEnabled: true,
    appVersion: "0.0.0",
    platform: "darwin",
    resolveOwner: () => ({ id: "account-1", email: "owner@example.test" }),
    resolveAgent: () => null,
    // The same resolver as `application-services.ts`.
    resolveRoutineRun: (agentId, routineId, runId) => {
      const run = agents.listRoutineRuns({ agentId, routineId }).find((item) => item.id === runId);
      const routine = agents.routineRecords.get({ kind: "agent", id: agentId }, routineId);
      if (!run || !routine) return null;
      return {
        runKind: run.kind,
        runSource: run.source ?? null,
        triggerType: routine.trigger.kind === "webhook" ? "webhook" : routine.trigger.schedule.kind,
      };
    },
  },
  () => client,
);
reportDelivery = (delivery) => analytics.handleWebhookDelivery(delivery);
agents.on("event", (event) => analytics.handleAgentEvent(event));

const realNow = Date.now.bind(Date);
let clockOffset = 0;
Date.now = () => realNow() + clockOffset;

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Builds",
      description: "Watches builds.",
      avatarSeed: "builds",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await waitFor("the first chat turn to end", () =>
    agents
      .listQueue(agent.id)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
  );
  const owner = { kind: "agent", id: agent.id } as const;
  const saved = await Effect.runPromise(
    events.saveRoutine({
      owner,
      name: ROUTINE_NAME,
      instruction: "Read the failed build.",
      active: true,
      timezone: "UTC",
      trigger: { kind: "webhook", eventType: "build.failed", filters: [] },
    }),
  );
  const secret = saved.secret;
  assert.ok(secret, "The save made no secret.");
  const route = agents.routineRecords.routes.list().find((item) => item.routineId === saved.routine.id);
  assert.ok(route, "The save made no route.");
  const routeId = route.routeId;
  const deliveryIds: string[] = [];

  const sign = (key: string, body: Uint8Array, timestamp: string, deliveryId: string) =>
    `sha256=${createHmac("sha256", key).update(`${timestamp}.${deliveryId}.`).update(body).digest("hex")}`;
  const deliver = async (
    label: string,
    options: { key?: string; route?: string; body?: Uint8Array; type?: string } = {},
  ) => {
    const body =
      options.body ??
      new TextEncoder().encode(JSON.stringify({ type: options.type ?? "build.failed", data: { log: BODY_MARK } }));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const deliveryId = randomUUID();
    deliveryIds.push(deliveryId);
    const { status } = await Effect.runPromise(
      events.receive({
        routeId: options.route ?? routeId,
        deliveryId,
        timestamp,
        signature: sign(options.key ?? secret, body, timestamp, deliveryId),
        body,
      }),
    );
    report.statuses[label] = status;
    return status;
  };
  const lastDelivery = async (count: number) => {
    await waitFor(`delivery event ${count}`, () => deliveries().length >= count);
    return deliveries()[count - 1] ?? {};
  };

  // 1. A signed request starts the routine.
  pass("A signed request starts the routine", (await deliver("started")) === 202);
  const started = await lastDelivery(1);
  pass(
    "The started request reports its owner, result, status and size",
    started.owner_kind === "agent" &&
      started.format === "openbot" &&
      started.result === "started" &&
      started.status_code === 202 &&
      typeof started.body_bytes === "number" &&
      started.body_bytes > 0 &&
      started.test === false,
    started,
  );
  pass(
    "The started request reports whole-number timings",
    Number.isInteger(started.handle_ms) && Number.isInteger(started.delivery_age_ms),
    started,
  );

  // 2. The run that the request started reports its trigger and source.
  const run = await waitFor("the finished webhook run event", () =>
    routineRuns().find((event) => event.status !== "running"),
  );
  pass(
    "The webhook run reports trigger_type webhook and run_source webhook",
    run.status === "succeeded" && run.trigger_type === "webhook" && run.run_source === "webhook",
    run,
  );

  // 3. Each refusal reports its result and status.
  pass("Another event type is ignored", (await deliver("ignored", { type: "build.passed" })) === 202);
  const ignored = await lastDelivery(2);
  pass(
    "The ignored request reports its reason",
    ignored.result === "ignored" && ignored.ignored_reason === "event-type" && ignored.status_code === 202,
    ignored,
  );
  pass("A wrong secret is refused", (await deliver("badSignature", { key: "whsec_not-the-secret" })) === 401);
  const badSignature = await lastDelivery(3);
  pass(
    "The refused signature reports its owner and no delivery age",
    badSignature.result === "bad_signature" &&
      badSignature.status_code === 401 &&
      badSignature.owner_kind === "agent" &&
      badSignature.delivery_age_ms === undefined,
    badSignature,
  );
  pass("An unknown route is refused", (await deliver("unknownRoute", { route: randomUUID() })) === 404);
  const unknown = await lastDelivery(4);
  pass(
    "The unknown route reports no owner",
    unknown.result === "unknown_route" && unknown.status_code === 404 && unknown.owner_kind === undefined,
    unknown,
  );
  pass(
    "A body that is not an event is refused",
    (await deliver("badBody", { body: new TextEncoder().encode(`not json ${BODY_MARK}`) })) === 400,
  );
  const badBody = await lastDelivery(5);
  pass(
    "The bad body reports a delivery age, as it was signed",
    badBody.result === "bad_body" && badBody.status_code === 400 && Number.isInteger(badBody.delivery_age_ms),
    badBody,
  );
  pass(
    "A body over the limit is refused",
    (await deliver("tooLarge", { body: new Uint8Array(WEBHOOK_DELIVERY_BODY_BYTES_LIMIT + 1) })) === 413,
  );
  const tooLarge = await lastDelivery(6);
  pass(
    "The large body reports too_large and its size",
    tooLarge.result === "too_large" &&
      tooLarge.status_code === 413 &&
      tooLarge.body_bytes === WEBHOOK_DELIVERY_BODY_BYTES_LIMIT + 1,
    tooLarge,
  );
  principal = null;
  pass("A signed-out host is unavailable", (await deliver("signedOut")) === 503);
  principal = "account-1";
  const signedOut = await lastDelivery(7);
  pass(
    "The signed-out request reports signed_out",
    signedOut.result === "signed_out" && signedOut.status_code === 503,
    signedOut,
  );

  // 4. A test event from Routines settings is a delivery with `test: true`.
  const test = await Effect.runPromise(events.sendTestEvent({ owner, id: saved.routine.id }));
  pass("The test event starts the routine", test.status === "started");
  const testEvent = await lastDelivery(8);
  pass("The test event reports test: true", testEvent.test === true && testEvent.result === "started", testEvent);
  await waitFor(
    "the test run to finish",
    () => routineRuns().filter((event) => event.status !== "running").length >= 2,
  );

  // 5. At most 60 delivery events go each minute; the next one counts the others.
  clockOffset += 61_000;
  const windowStart = deliveries().length;
  for (let index = 0; index < 65; index += 1) await deliver("capped", { route: randomUUID() });
  await waitFor("the capped window", () => deliveries().length >= windowStart + 60);
  const sentInWindow = deliveries().length - windowStart;
  clockOffset += 61_000;
  await deliver("afterCap", { route: randomUUID() });
  const afterCap = await lastDelivery(windowStart + 61);
  report.cap = { sentInWindow, skippedCount: afterCap.skipped_count };
  pass("Only 60 delivery events go in one minute", sentInWindow === 60, sentInWindow);
  pass("The next event counts the 5 that did not go", afterCap.skipped_count === 5, afterCap);

  // 6. The events carry only the allowed keys, and no ID, secret, name or body text.
  report.deliveries = deliveries();
  report.routineRuns = routineRuns();
  pass(
    "Delivery events carry only the allowed keys",
    report.deliveries.every((properties) => Object.keys(properties).every((key) => DELIVERY_KEYS.has(key))),
  );
  const body = JSON.stringify(sent);
  const leaks = [routeId, secret, saved.routine.id, ROUTINE_NAME, BODY_MARK, ...deliveryIds].filter((value) =>
    body.includes(value),
  );
  pass("No event has a route ID, delivery ID, secret, routine name or body text", leaks.length === 0, leaks);

  // 7. The route limit failure gets its own failure code in the renderer, as it crosses IPC.
  for (let index = agents.routineRecords.routes.list().length; index < WEBHOOK_ROUTES_LIMIT; index += 1) {
    await Effect.runPromise(
      events.saveRoutine({
        owner,
        name: `Filler ${index}`,
        instruction: "Never runs.",
        active: false,
        timezone: "UTC",
        trigger: { kind: "webhook", eventType: null, filters: [] },
      }),
    );
  }
  // The IPC handler runs the save with `runCauseEffect`, which throws the wrapped catalog error.
  const limitError = await runCauseEffect(
    events.saveRoutine({
      owner,
      name: "Over the limit",
      instruction: "Never runs.",
      active: false,
      timezone: "UTC",
      trigger: { kind: "webhook", eventType: null, filters: [] },
    }),
  ).then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  assert.ok(limitError, "The save over the route limit did not fail.");
  report.routeLimitCode = webhookFailureCode(
    new Error(`Error invoking remote method 'events:save-routine': Error: ${limitError}`),
    "save_failed",
  );
  pass("The route limit failure maps to webhook_route_limit", report.routeLimitCode === "webhook_route_limit");
  pass(
    "Another failure keeps its fallback code",
    webhookFailureCode(new Error("Other."), "save_failed") === "save_failed",
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  Date.now = realNow;
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
