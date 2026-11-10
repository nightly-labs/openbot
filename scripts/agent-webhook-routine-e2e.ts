// Checks that an agent creates a webhook routine from its chat with `openbot.create_webhook_routine`.
// Runs the real agent service, tool router and events service on a temporary profile with a fake
// Codex app-server. The fake calls the tool through `tool_call`, as a model does, and logs the tool
// result that it gets. The relay is a fake that gives a URL, or fails while it is "down".
// The check asserts that the result has the URL and the request format and no signing secret, that
// the chat records the creation for the card, that the routine lists with the webhook routines, that
// a duplicate name and a bad filter come back as tool failures, and that a request signed with the
// secret the card makes starts the routine, that test_routine refuses it with a message that names
// Routines settings, and that delete_routine deletes it. It also checks Standard Webhooks requests, as
// Composio sends them: the sender's own secret (raw, and `whsec_` base64), the `v1,` signature, and
// a filter on `/metadata/trigger_slug`, which matches because the whole body is the event data.
// `bun scripts/agent-webhook-routine-e2e.ts`. Writes .openbot-build/agent-webhook-routine-e2e/report.json.
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent, routineConversationEvent } from "@openbot/contracts/ipc";
import type { EventActivity, EventRoutine } from "@openbot/contracts/ipc-events";
import {
  STANDARD_WEBHOOKS_FORMAT,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "@openbot/contracts/signal-protocol/webhook-route";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-webhook-routine-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-webhook-tool-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

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
const { agentWebhookRoutineWriter, HostEventsService } = await import("../src/main/host-events-service");

const RELAY_ORIGIN = "https://signal.example.test";
const CALL_MARK = "WEBHOOK-CALL";

/**
 * A Codex app-server with the methods that the service calls. A turn whose input has
 * `WEBHOOK-CALL <<ARGS{json}ARGS>>` calls `openbot.create_webhook_routine` with that JSON through
 * `tool_call`, logs the result, and ends. Other turns answer "Done.".
 */
const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
/** Tool request id -> the turn that waits for its result. */
const waiting = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (threadId, turnId) => {
  const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
  write({ method: "item/completed", params: { threadId, turnId, item } });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
};
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
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const match = text.includes(${JSON.stringify(CALL_MARK)}) ? /<<ARGS([\\s\\S]*?)ARGS>>/.exec(text) : null;
      if (!match) return setTimeout(() => finish(params.threadId, turnId), 20);
      const id = "tool-" + turnId;
      waiting.set(id, { threadId: params.threadId, turnId });
      return write({
        id,
        method: "item/tool/call",
        params: {
          threadId: params.threadId,
          turnId,
          callId: "call-" + turnId,
          namespace: "openbot",
          tool: "tool_call",
          arguments: (() => {
            const { __tool = "create_webhook_routine", ...args } = JSON.parse(match[1]);
            return { name: "openbot." + __tool, arguments: args };
          })(),
        },
      });
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
      else if (!message.method && waiting.has(message.id)) {
        const turn = waiting.get(message.id);
        waiting.delete(message.id);
        log({ turnId: turn.turnId, result: message.result ?? null, error: message.error ?? null });
        finish(turn.threadId, turn.turnId);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface ToolLog {
  turnId: string;
  result: { success: boolean; contentItems: { type: string; text: string }[] } | null;
  error: unknown;
}

/** The arguments the fake passes to the tool. */
/** The arguments the fake passes to the tool that `__tool` names (default `create_webhook_routine`). */
interface WebhookToolArgs {
  __tool?: "create_webhook_routine" | "update_webhook_routine" | "list_routines" | "delete_routine" | "test_routine";
  routineId?: string;
  name?: string;
  instruction?: string;
  eventType?: string;
  filters?: { pointer: string; value: string }[];
}

/** The fields of a tool result that the check reads. The router sends them as JSON text. */
interface WebhookToolBody {
  error?: string;
  deleted?: boolean;
  webhookRoutines?: { routineId: string; eventType: string | null; filters: unknown[] }[];
  eventType?: string | null;
  filters?: { pointer: string; value: string }[];
  routineId?: string;
  url?: string | null;
  urlPending?: string;
  secret?: string;
  request?: { headers: Record<string, string>; standardWebhooks?: string };
}

const report: {
  calls: { name: string; turnId: string; success: boolean | null; body: WebhookToolBody | null }[];
  routines: EventRoutine[];
  receive?: { signed: number; wrongSecret: number; activity: EventActivity[] };
  standard?: {
    refusals: { shortSecret: string | null; scheduleRoutine: string | null };
    statuses: Record<string, number>;
    activity: EventActivity[];
  };
  checks: { name: string; passed: boolean }[];
  passed: boolean;
  error?: string;
} = { calls: [], routines: [], checks: [], passed: false };

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

/** Waits for a state of the service or the fake's log. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function toolLogs(): ToolLog[] {
  let text = "";
  try {
    text = readFileSync(fakeLog, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function pass(name: string, condition: boolean, detail?: string) {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
let relayUp = true;
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  // As in the app: the events service is built after the agent service.
  webhookRoutines: () => agentWebhookRoutineWriter(events),
});
const events = new HostEventsService({
  routines: agents.routineRecords,
  // Reversible and visible, so the check can see that the stored value is not the secret.
  cipher: {
    encrypt: (value) => Buffer.from(`sealed:${Buffer.from(value).toString("base64")}`),
    decrypt: (value) => Buffer.from(value.toString().slice("sealed:".length), "base64").toString(),
  },
  relay: {
    connected: () => relayUp,
    setEnabled: () => {},
    setAccountActive: () => {},
    refresh: () => {},
    ensureHost: () => Effect.void,
    registerRoute: (routeId) =>
      relayUp
        ? Effect.succeed(`${RELAY_ORIGIN}/v1/webhooks/${routeId}`)
        : Effect.fail({ cause: new Error("The relay is down.") }),
    revokeRoute: () => Effect.void,
  },
  accountPrincipal: () => "account-1",
});
const agentEvents: AgentEvent[] = [];
agents.on("event", (event) => agentEvents.push(event));

/**
 * Sends a chat message that makes the fake call the tool, and returns the tool result it logged for
 * that message's turn. A webhook run can call a tool at the same time in its own session.
 */
async function callTool(name: string, agentId: string, args: WebhookToolArgs) {
  const receipt = await runCauseEffect(
    agents.sendMessage({ agentId, text: `${CALL_MARK} <<ARGS${JSON.stringify(args)}ARGS>>` }),
  );
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, `${name}: no delivery`);
  const turnId = await waitFor(`${name} turn`, () => mailbox.getDelivery(deliveryId)?.delivery.turnId);
  const entry = await waitFor(`${name} tool result`, () => toolLogs().find((log) => log.turnId === turnId));
  await waitFor(`${name} turn end`, () => {
    const status = mailbox.getDelivery(deliveryId)?.delivery.status;
    return status === "completed" || status === "failed" || status === "interrupted";
  });
  const text = entry.result?.contentItems.map((item) => item.text).join("\n") ?? "";
  // A JSON-RPC error has no body; the check then fails on `success`.
  const body: WebhookToolBody | null = text ? JSON.parse(text) : null;
  report.calls.push({ name, turnId: entry.turnId, success: entry.result?.success ?? null, body });
  return { entry, text, body };
}

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

  // 1. The relay is up: the routine gets its URL at once.
  const created = await callTool("create", agent.id, {
    name: "Failed builds",
    instruction: "Read the failed build and tell me which test failed.",
    eventType: "build.failed",
    filters: [{ pointer: "/branch", value: "main" }],
  });
  pass("The tool call succeeds", created.entry.result?.success === true, created.text);
  const result = created.body;
  assert.ok(result?.routineId && result.request && result.secret, created.text);
  const headers = result.request.headers;
  pass("The result has the relay URL", result.url?.startsWith(`${RELAY_ORIGIN}/v1/webhooks/`) === true);
  pass(
    "The result has the request headers",
    [WEBHOOK_TIMESTAMP_HEADER, WEBHOOK_DELIVERY_ID_HEADER, WEBHOOK_SIGNATURE_HEADER].every(
      (header) => header in headers,
    ),
  );
  pass("The result has no signing secret", !created.text.includes("whsec_"));
  pass("The result sends the user to the chat card", result.secret.includes("card in this chat"));
  pass(
    "The result names Standard Webhooks senders and the sender's secret",
    result.request.standardWebhooks?.includes("Composio") === true &&
      result.request.standardWebhooks.includes("/metadata/trigger_slug"),
  );

  const listed = await Effect.runPromise(events.listRoutines({ owner }));
  report.routines = listed;
  const routine = listed.find((item) => item.id === result.routineId);
  pass(
    "The routine lists as a webhook routine with its settings",
    routine?.trigger.kind === "webhook" &&
      routine.trigger.url === result.url &&
      routine.trigger.eventType === "build.failed" &&
      routine.trigger.filters.length === 1 &&
      routine.active,
  );
  pass(
    "The routine change reaches the routine views",
    agentEvents.some((event) => event.type === "routines-changed" && event.agentId === agent.id),
  );
  const conversation = await runCauseEffect(agents.readConversation(agent.id));
  const record = conversation.messages.find(
    (message) => routineConversationEvent(message)?.routineId === result.routineId,
  );
  pass(
    "The chat records the creation with its turn, for the card",
    record !== undefined && routineConversationEvent(record)?.action === "created" && Boolean(record.turnId),
  );
  pass("No secret is in the chat", !JSON.stringify(conversation.messages).includes("whsec_"));

  // 2. The same name again is a failure the model can correct.
  const duplicate = await callTool("duplicate name", agent.id, {
    name: "failed builds",
    instruction: "Again.",
  });
  pass(
    "A duplicate name is a tool failure",
    duplicate.entry.result?.success === false && duplicate.text.includes("already exists"),
  );

  // 3. A bad filter is a failure the model can correct.
  const badFilter = await callTool("bad filter", agent.id, {
    name: "Bad filter",
    instruction: "Never runs.",
    filters: [{ pointer: "branch", value: "main" }],
  });
  pass("A bad filter is a tool failure", badFilter.entry.result?.success === false);

  // 4. The relay is down: the routine saves with no URL yet.
  relayUp = false;
  const pending = await callTool("relay down", agent.id, {
    name: "Deploys",
    instruction: "Report the deploy.",
  });
  relayUp = true;
  pass(
    "With the relay down the routine saves with a pending URL",
    pending.entry.result?.success === true && pending.body?.url === null && Boolean(pending.body.urlPending),
  );

  // 5. A routine run is not a person's request, so it cannot make a public route.
  const before = toolLogs().length;
  const runner = agents.createRoutine({
    agentId: agent.id,
    name: "Injected",
    instruction: `${CALL_MARK} <<ARGS${JSON.stringify({ name: "From a run", instruction: "Never." })}ARGS>>`,
    active: false,
    timezone: "UTC",
    schedule: { kind: "daily", time: "09:00" },
  });
  await runCauseEffect(agents.testRoutine({ agentId: agent.id, routineId: runner.id }));
  const fromRun = await waitFor("the routine run tool result", () => toolLogs()[before]);
  const fromRunText = fromRun.result?.contentItems.map((item) => item.text).join("\n") ?? "";
  report.calls.push({
    name: "routine run",
    turnId: fromRun.turnId,
    success: fromRun.result?.success ?? null,
    body: fromRunText ? JSON.parse(fromRunText) : null,
  });
  const afterRun = await Effect.runPromise(events.listRoutines({ owner }));
  pass(
    "A routine run cannot create a webhook routine",
    fromRun.result?.success === false &&
      fromRunText.includes("Only a person's message") &&
      !afterRun.some((item) => item.name === "From a run"),
  );

  // 6. The card makes the secret; a request signed with it starts the routine.
  const { secret } = await Effect.runPromise(events.rotateSecret({ owner, id: result.routineId }));
  const routeId = new URL(result.url ?? "").pathname.split("/").at(-1) ?? "";
  const body = new TextEncoder().encode(JSON.stringify({ type: "build.failed", data: { branch: "main" } }));
  const deliver = (key: string) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const deliveryId = randomUUID();
    const signature = `sha256=${createHmac("sha256", key).update(`${timestamp}.${deliveryId}.`).update(body).digest("hex")}`;
    return Effect.runPromise(events.receive({ routeId, deliveryId, timestamp, signature, body }));
  };
  const wrong = await deliver("whsec_not-the-secret");
  const signed = await deliver(secret);
  const activity = await Effect.runPromise(events.listActivity({ owner, routineId: result.routineId }));
  report.receive = { signed: signed.status, wrongSecret: wrong.status, activity };
  pass("A request with another secret is refused", wrong.status === 401);
  pass(
    "A request signed with the card's secret starts the routine",
    signed.status === 202 && activity.some((item) => item.status === "started"),
  );

  // 7. The agent finds the routine and changes its filters. The URL and the secret stay.
  const listedByTool = await callTool("list", agent.id, { __tool: "list_routines" });
  pass(
    "list_routines shows the webhook routine with its filters",
    listedByTool.body?.webhookRoutines?.some(
      (item) => item.routineId === result.routineId && item.eventType === "build.failed" && item.filters.length === 1,
    ) === true,
  );
  const updated = await callTool("update", agent.id, {
    __tool: "update_webhook_routine",
    routineId: result.routineId,
    // The receiver compares the type exactly, so the spaces must not reach the store.
    eventType: " build.failed ",
    filters: [{ pointer: "/branch", value: "release" }],
  });
  const afterUpdate = (await Effect.runPromise(events.listRoutines({ owner }))).find(
    (item) => item.id === result.routineId,
  );
  pass(
    "The update changes the filters and keeps the event type and the URL",
    updated.entry.result?.success === true &&
      afterUpdate?.trigger.kind === "webhook" &&
      afterUpdate.trigger.eventType === "build.failed" &&
      afterUpdate.trigger.filters[0]?.value === "release" &&
      afterUpdate.trigger.url === result.url,
    updated.text,
  );
  const updatedConversation = await runCauseEffect(agents.readConversation(agent.id));
  pass(
    "The chat records the change with its turn, for the card",
    updatedConversation.messages.some((message) => {
      const event = routineConversationEvent(message);
      return event?.routineId === result.routineId && event?.action === "updated" && Boolean(message.turnId);
    }),
  );
  const outside = await deliver(secret);
  const latest = await Effect.runPromise(events.listActivity({ owner, routineId: result.routineId }));
  pass(
    "The same secret still signs, and a request outside the new filter is ignored",
    outside.status === 202 && latest[0]?.status === "ignored" && latest[0]?.reason === "filter",
  );

  // 7b. A Standard Webhooks sender, such as Composio, makes its own secret. The person pastes it; the
  // agent sets a filter on the sender's metadata, which the whole body carries as the event data.
  const refusal = (secretValue: string, id: string) =>
    Effect.runPromise(events.setSecret({ owner, id, secret: secretValue })).then(
      () => null,
      (error: unknown) => String(error),
    );
  const shortSecret = await refusal("too-short", result.routineId);
  const scheduleRoutine = await refusal(randomBytes(24).toString("hex"), runner.id);
  pass("A sender's secret that is too short is refused", shortSecret !== null);
  pass("A schedule routine refuses a sender's secret", scheduleRoutine !== null);
  const composio = await callTool("composio filter", agent.id, {
    __tool: "update_webhook_routine",
    routineId: result.routineId,
    eventType: "composio.trigger.message",
    filters: [{ pointer: "/metadata/trigger_slug", value: "GMAIL_NEW_GMAIL_MESSAGE" }],
  });
  pass("The agent sets a filter on the sender's metadata", composio.entry.result?.success === true, composio.text);
  const rawSecret = randomBytes(24).toString("hex");
  // Spaces from a paste do not become part of the key.
  await Effect.runPromise(events.setSecret({ owner, id: result.routineId, secret: ` ${rawSecret}\n` }));
  const standardBody = (slug: string) =>
    new TextEncoder().encode(
      JSON.stringify({
        id: randomUUID(),
        type: "composio.trigger.message",
        timestamp: "2026-11-03T10:00:00.000Z",
        metadata: { trigger_slug: slug, trigger_id: "ti_e2e" },
        data: { subject: "Invoice" },
      }),
    );
  const deliverStandard = (key: Buffer | string, payload: Uint8Array) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const deliveryId = `msg_${randomUUID().replaceAll("-", "")}`;
    const digest = createHmac("sha256", key).update(`${deliveryId}.${timestamp}.`).update(payload).digest("base64");
    // A sender can list several signatures, for example during its own key rotation.
    const signature = `v1,${randomBytes(32).toString("base64")} v1,${digest}`;
    return Effect.runPromise(
      events.receive({ routeId, deliveryId, timestamp, signature, body: payload, format: STANDARD_WEBHOOKS_FORMAT }),
    );
  };
  const statuses: Record<string, number> = {};
  statuses.rawKey = (await deliverStandard(rawSecret, standardBody("GMAIL_NEW_GMAIL_MESSAGE"))).status;
  statuses.otherSlug = (await deliverStandard(rawSecret, standardBody("SLACK_RECEIVE_MESSAGE"))).status;
  statuses.wrongKey = (await deliverStandard("not-the-secret", standardBody("GMAIL_NEW_GMAIL_MESSAGE"))).status;
  statuses.oldSecret = (await deliver(secret)).status;
  const encoded = randomBytes(24);
  await Effect.runPromise(
    events.setSecret({ owner, id: result.routineId, secret: `whsec_${encoded.toString("base64")}` }),
  );
  statuses.whsecKey = (await deliverStandard(encoded, standardBody("GMAIL_NEW_GMAIL_MESSAGE"))).status;
  // Node skips characters that are not base64: this value decodes to one byte, which is not a key.
  const malformed = "whsec_!!!!!!!!!!!!!!!!AA==";
  await Effect.runPromise(events.setSecret({ owner, id: result.routineId, secret: malformed }));
  statuses.malformedKey = (
    await deliverStandard(Buffer.from(malformed.slice(6), "base64"), standardBody("GMAIL_NEW_GMAIL_MESSAGE"))
  ).status;
  const standardActivity = await Effect.runPromise(events.listActivity({ owner, routineId: result.routineId }));
  report.standard = { refusals: { shortSecret, scheduleRoutine }, statuses, activity: standardActivity };
  const [whsecReceipt, slugReceipt, rawReceipt] = standardActivity;
  pass(
    "A Standard Webhooks request signed with the raw sender's secret starts the routine",
    statuses.rawKey === 202 && rawReceipt?.status === "started" && rawReceipt.eventType === "composio.trigger.message",
  );
  pass(
    "A Standard Webhooks request for another trigger slug is ignored by the metadata filter",
    statuses.otherSlug === 202 && slugReceipt?.status === "ignored" && slugReceipt.reason === "filter",
  );
  pass("A Standard Webhooks request with another key is refused", statuses.wrongKey === 401);
  pass("The secret that the host made stops working", statuses.oldSecret === 401);
  pass(
    "A whsec_ sender's secret signs with its base64 key",
    statuses.whsecKey === 202 && whsecReceipt?.status === "started",
  );
  pass("A whsec_ value that is not exact base64 is not a short key", statuses.malformedKey === 401);
  pass(
    "The sender's secret is not in the chat",
    !JSON.stringify((await runCauseEffect(agents.readConversation(agent.id))).messages).includes(rawSecret),
  );

  // 8. test_routine does not test a webhook routine and names Routines settings. delete_routine
  // deletes it as Routines settings do (#4509).
  const refused = await callTool("test_routine", agent.id, { __tool: "test_routine", routineId: result.routineId });
  pass(
    "test_routine refuses the webhook routine and names Routines settings",
    refused.entry.result?.success === false &&
      refused.body?.error?.includes("webhook routine") === true &&
      refused.body.error.includes("Routines settings"),
    refused.text,
  );
  const deleted = await callTool("delete_routine", agent.id, { __tool: "delete_routine", routineId: result.routineId });
  const afterDelete = await Effect.runPromise(events.listRoutines({ owner }));
  pass(
    "delete_routine deletes the webhook routine",
    deleted.entry.result?.success === true &&
      deleted.body?.deleted === true &&
      !afterDelete.some((item) => item.id === result.routineId),
    deleted.text,
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
