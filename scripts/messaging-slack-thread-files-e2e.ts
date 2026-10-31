// Checks that a file posted in a Slack thread without a mention reaches the agent when a later reply
// mentions OpenBot, with one thread read for the message and its prompt, and that a rate-limited
// thread read lets the message run without the files and leaves the connection connected. Slack
// events go through the relay into the real Slack driver and messaging service on a temporary
// profile, and the driver calls a fake Slack Web API on 127.0.0.1. No agent turn runs: the check
// reads the prompt that a turn would get.
// `bun scripts/messaging-slack-thread-files-e2e.ts`. Writes .openbot-build/messaging-slack-thread-files-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SLACK_BOT_SCOPES } from "@openbot/contracts/slack-app";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { type MessagingCredentials, MessagingService } from "../src/backend/messaging/messaging-service";
import { MessagingThreads } from "../src/backend/messaging/messaging-threads";
import type { IngressHandler, MessagingIngress } from "../src/backend/messaging/messaging-types";
import { slackDriver } from "../src/backend/messaging/slack/slack-driver";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/messaging-slack-thread-files-e2e");
const REPORT = join(OUT, "report.json");
const root = await mkdtemp(join(tmpdir(), "openbot-messaging-slack-files-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const TEAM = "T0THREADFILES";
const APP = "A0THREADFILES";
const BOT_USER = "U0OPENBOT";
const CHANNEL = "C0GENERAL";
const ANA = "U0ANA";
const BOB = "U0BOB";
const NAMES: Record<string, string> = { [ANA]: "Ana", [BOB]: "Bob" };
// A fake value. The report must never contain it.
const BOT_TOKEN = "xoxb-fake-token-for-thread-files-e2e";
const IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { steps: Step[]; passed: boolean; unverified: string[] } = {
  steps: [],
  passed: false,
  unverified: [
    "Slack itself: a fake Web API on 127.0.0.1 stands in for slack.com and files.slack.com, so the real shape of `conversations.replies` and Slack's real rate limits are not checked here.",
    "The Signal ingress socket and Slack's signature check: the check calls the service's relay handler in this process.",
    "An agent turn: the check reads the prompt that the turn would get, and no provider runs.",
  ],
};

async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  const entry: Step = { name, passed: false };
  report.steps.push(entry);
  try {
    entry.detail = await run();
    entry.passed = true;
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};

/** One message of a thread, as `conversations.replies` gives it. */
interface SlackMessage {
  ts: string;
  thread_ts: string;
  user: string;
  text: string;
  subtype?: string;
  files?: { id: string; name: string; mimetype: string; size: number; url_private_download: string }[];
}

/** One request that the fake Slack Web API received. */
interface Call {
  method: string;
  params: Record<string, string>;
  authorization: string | null;
}

const calls: Call[] = [];
const waiters: Array<{ match: (call: Call) => boolean; resolve: () => void }> = [];
/** The messages of each thread, by its parent's ts. */
const threads = new Map<string, SlackMessage[]>();
/** Threads whose `conversations.replies` Slack refuses with HTTP 429. */
const limited = new Set<string>();
let posted = 0;

/** The answer of the fake Web API to one call. */
interface Answer {
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
}

function answer({ method, params }: Call): Answer {
  switch (method) {
    case "auth.test":
      return {
        headers: { "x-oauth-scopes": SLACK_BOT_SCOPES.join(",") },
        body: { ok: true, team_id: TEAM, team: "Nightly", user_id: BOT_USER, bot_id: "B0OPENBOT" },
      };
    case "bots.info":
      return { body: { ok: true, bot: { app_id: APP } } };
    case "users.info":
      return { body: { ok: true, user: { profile: { display_name: NAMES[params.user ?? ""] ?? "" } } } };
    case "conversations.info":
      return { body: { ok: true, channel: { name: "general" } } };
    case "conversations.replies": {
      const thread = params.ts ?? "";
      if (limited.has(thread))
        return { status: 429, headers: { "retry-after": "60" }, body: { ok: false, error: "ratelimited" } };
      const oldest = Number(params.oldest ?? "0");
      const latest = Number(params.latest ?? "Infinity");
      const messages = (threads.get(thread) ?? []).filter(
        (message) => Number(message.ts) > oldest && Number(message.ts) < latest,
      );
      return { body: { ok: true, messages, has_more: false } };
    }
    case "chat.postMessage":
      posted += 1;
      return { body: { ok: true, ts: `1761700000.${String(posted).padStart(6, "0")}` } };
    default:
      return { body: { ok: true, channels: [] } };
  }
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const authorization = request.headers.authorization ?? null;
    if (url.pathname.startsWith("/files/")) {
      calls.push({ method: "files.download", params: { path: url.pathname }, authorization });
      response.writeHead(200, { "content-type": "image/png", "content-length": String(IMAGE.byteLength) });
      response.end(IMAGE);
      return;
    }
    const method = url.pathname.replace(/^\/api\//u, "");
    const params = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
    const call = { method, params, authorization };
    calls.push(call);
    for (const waiter of waiters.splice(0)) {
      if (waiter.match(call)) waiter.resolve();
      else waiters.push(waiter);
    }
    const { status = 200, headers = {}, body } = answer(call);
    response.writeHead(status, { "content-type": "application/json", ...headers });
    response.end(JSON.stringify(body));
  });
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert.ok(address && typeof address === "object");
const ORIGIN = `http://127.0.0.1:${address.port}`;

/** Fails after 15 seconds, so a call that never comes fails the check instead of holding it. */
function waitForCall(match: (call: Call) => boolean): Promise<void> {
  if (calls.some(match)) return Promise.resolve();
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("The expected Slack call did not come.")), 15_000);
    waiters.push({
      match,
      resolve: () => {
        clearTimeout(timer);
        done();
      },
    });
  });
}

/** The service reacts 👀 to a message it queued. */
const received = (ts: string) =>
  waitForCall((call) => call.method === "reactions.add" && call.params.timestamp === ts && call.params.name === "eyes");

const repliesCalls = (thread: string) =>
  calls.filter((call) => call.method === "conversations.replies" && call.params.ts === thread).length;

let relayHandler: IngressHandler | null = null;
const ingress: MessagingIngress = {
  acquire: () => () => {},
  state: () => "online",
  onState: () => () => {},
  handle: (handler) => {
    relayHandler = handler;
  },
  telegram: { available: () => false, call: unused, download: unused, upload: unused },
  reconnect: () => {},
  discord: unused,
  onDiscordRoutes: () => () => {},
};

let eventId = 0;
/** The `event` of an Events API request: a message, without `thread_ts` when it starts a thread. */
type SlackEvent = Omit<SlackMessage, "thread_ts"> & {
  type: "message" | "app_mention";
  channel: string;
  channel_type?: string;
  thread_ts?: string;
};

/** One Events API request, as Signal passes it on after it checked Slack's signature. */
async function slackEvent(event: SlackEvent): Promise<void> {
  eventId += 1;
  const handler = relayHandler;
  assert.ok(handler, "The messaging service has no relay handler.");
  const body = { type: "event_callback", team_id: TEAM, api_app_id: APP, event_id: `Ev${eventId}`, event };
  const result = await runCauseEffect(
    handler(TEAM, {
      platform: "slack",
      kind: "events",
      retryNum: null,
      body: new TextEncoder().encode(JSON.stringify(body)),
    }),
  );
  assert.equal(result.status, 200);
}

/** A person posts an image as a new thread, without a mention: Slack sends a `file_share` message. */
async function postImage(ts: string, name: string): Promise<void> {
  const message: SlackMessage = {
    ts,
    thread_ts: ts,
    user: ANA,
    text: "it crashes on start",
    subtype: "file_share",
    files: [
      {
        id: `F${ts.replace(".", "")}`,
        name,
        mimetype: "image/png",
        size: IMAGE.byteLength,
        url_private_download: `${ORIGIN}/files/${ts}/${name}`,
      },
    ],
  };
  threads.set(ts, [message]);
  const { thread_ts: _thread, ...event } = message;
  await slackEvent({ type: "message", channel: CHANNEL, channel_type: "channel", ...event });
}

/** Another person mentions OpenBot in a reply to the thread. */
async function mentionInThread(thread: string, ts: string, text: string): Promise<void> {
  const message: SlackMessage = { ts, thread_ts: thread, user: BOB, text: `<@${BOT_USER}> ${text}` };
  threads.get(thread)?.push(message);
  await slackEvent({ type: "app_mention", channel: CHANNEL, ...message });
}

function memoryCredentials(): MessagingCredentials {
  const values = new Map<string, Record<string, string>>();
  return {
    keys: () => [...values.keys()],
    status: (connectionId) => (values.has(connectionId) ? "saved" : "missing"),
    get: (connectionId) => values.get(connectionId) ?? null,
    set: (connectionId, value) => Effect.sync(() => void values.set(connectionId, value)),
    clear: (connectionId) => Effect.sync(() => void values.delete(connectionId)),
    retain: (connectionIds) =>
      Effect.sync(() => {
        for (const key of values.keys()) if (!connectionIds.has(key)) values.delete(key);
      }),
  };
}
const credentials = memoryCredentials();

interface Booted {
  messaging: MessagingService;
  threads: MessagingThreads;
  mailbox: MailboxStore;
}

async function boot<T>(use: (services: Booted) => Promise<T>): Promise<T> {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const agents = new AgentService({ store, mailbox, browser, sidebarLayout: sidebar });
  // Its own threads, which start no turn: no provider runs in this check.
  const messagingThreads = new MessagingThreads(store.database, mailbox, {
    schedule: () => {},
    queueChanged: () => {},
    busy: () => false,
    interrupt: unused,
    forgetThread: () => Effect.void,
    ownChat: () => false,
    contextSession: () => null,
  });
  const messaging = new MessagingService({
    threads: messagingThreads,
    agents: {
      listAgents: () => agents.listAgents(),
      respondToApproval: (input) => agents.respondToApproval(input),
      onEvent: () => () => {},
      createAgentProfile: (input) => agents.createAgentProfile(input),
      createMemory: (input) => agents.createMemory(input),
      ensureDeletable: (agentId) => agents.ensureAgentDeletable(agentId),
      deleteAgent: (agentId) => agents.deleteAgent(agentId),
      sidebarChatIds: () => agents.sidebarChatIds(),
    },
    credentials,
    drivers: [slackDriver({ origin: ORIGIN, ingress })],
    downloadsRoot: join(userData, "messaging-downloads"),
    ingress,
    slackOrigin: ORIGIN,
    sidebar,
  });
  await runCauseEffect(messaging.start());
  try {
    return await use({ messaging, threads: messagingThreads, mailbox });
  } finally {
    await runCauseEffect(messaging.stop());
    await runCauseEffect(agents.stop());
    database.close();
  }
}

function connectionId(services: Booted): string {
  const record = services.threads.store.connectionForWorkspace("slack", TEAM);
  assert.ok(record, "The Slack connection is not stored.");
  return record.connectionId;
}

function delivery(services: Booted, ts: string) {
  const context = services.mailbox.deliveryForKey(`messaging:${connectionId(services)}:${CHANNEL}:${ts}`);
  assert.ok(context, "The mention has no delivery.");
  return context;
}

async function promptOf(services: Booted, ts: string): Promise<string> {
  const prepared = await runCauseEffect(services.threads.prepare(delivery(services, ts)));
  assert.ok(prepared, "The delivery has no prompt.");
  return prepared.text;
}

function connectionState(services: Booted) {
  const connection = services.messaging.slackOverview().connections.find((item) => item.workspaceId === TEAM);
  assert.ok(connection, "The Slack connection is not in the overview.");
  return { state: connection.state, retryAt: connection.retryAt };
}

try {
  // The connection exists before the boot, as after the OAuth callback.
  await boot(async ({ threads: store }) => {
    const record = store.store.ensureConnection("slack", TEAM, "Nightly");
    store.store.updateConnection(record.connectionId, { enabled: true });
    await runCauseEffect(credentials.set(record.connectionId, { botToken: BOT_TOKEN }));
  });

  await boot(async (services) => {
    await step("the Slack connection identifies against the fake Web API and gets an orchestrator", async () => {
      assert.deepEqual(connectionState(services), { state: "connected", retryAt: null });
      const orchestrator = await runCauseEffect(services.messaging.addOrchestrator("slack", { workspaceId: TEAM }));
      return { orchestrator: Boolean(orchestrator.agentId) };
    });

    await step("an image posted in a thread before a mention in it gives the image to the agent", async () => {
      const parent = "1761650000.000100";
      const mention = "1761650060.000200";
      await postImage(parent, "crash.png");
      // The image has no mention: the transport passes nothing on, so nothing reads the thread.
      assert.equal(repliesCalls(parent), 0, "A message without a mention read the thread.");
      await mentionInThread(parent, mention, "make an issue for this");
      await received(mention);
      assert.deepEqual(
        delivery(services, mention).managedAttachments.map((file) => file.name),
        ["crash.png"],
        "The agent's message has no earlier image.",
      );
      const downloads = calls.filter((call) => call.method === "files.download");
      assert.deepEqual(
        downloads.map((call) => [call.params.path, call.authorization]),
        [[`/files/${parent}/crash.png`, `Bearer ${BOT_TOKEN}`]],
      );
      const prompt = await promptOf(services, mention);
      assert.match(
        prompt,
        /--- earlier messages \(context, oldest first\) ---\n\[2025-10-28T11:13:20\.000Z\] Ana: it crashes on start\n\(Attached files: crash\.png\)\n--- message ---\n/u,
      );
      assert.match(
        prompt,
        /--- message ---\nmake an issue for this\n\n\(Files of earlier messages, given with this one: Ana: crash\.png\)/u,
      );
      assert.doesNotMatch(prompt, /did not arrive|not given/u);
      assert.equal(repliesCalls(parent), 1, "The message and its prompt did not share one thread read.");
      return { attachments: ["crash.png"], threadReads: repliesCalls(parent) };
    });

    await step("a thread read that Slack limits lets the message run without earlier files", async () => {
      const parent = "1761650200.000100";
      const mention = "1761650260.000200";
      limited.add(parent);
      await postImage(parent, "trace.png");
      const started = Date.now();
      await mentionInThread(parent, mention, "and this one?");
      await received(mention);
      assert.deepEqual(delivery(services, mention).managedAttachments, [], "A limited read gave earlier files.");
      const prompt = await promptOf(services, mention);
      const waitedMs = Date.now() - started;
      assert.doesNotMatch(prompt, /earlier messages/u);
      assert.match(prompt, /--- message ---\nand this one\?$/u);
      // Each read fails at once and is not kept: the message and its prompt try once each.
      assert.equal(repliesCalls(parent), 2);
      assert.ok(waitedMs < 10_000, `The limited read waited ${waitedMs} ms.`);
      assert.deepEqual(connectionState(services), { state: "connected", retryAt: null });
      return { threadReads: repliesCalls(parent), state: connectionState(services).state };
    });
  });

  report.passed = true;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  server.close();
  await rm(root, { recursive: true, force: true });
}
assert.ok(!readFileSync(REPORT, "utf8").includes(BOT_TOKEN), "The report contains the bot token.");
process.stdout.write(`Slack thread files check passed. Report: ${REPORT}\n`);
