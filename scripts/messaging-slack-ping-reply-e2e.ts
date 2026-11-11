// Checks that a person whom an agent's Slack post pinged can answer in the thread without a mention
// (#5565). Runs the real agent and messaging services on a temporary profile, the real Slack event
// parser and Slack mention renderer, and a fake Slack platform: `bun scripts/messaging-slack-ping-reply-e2e.ts`.
//
// 1. `messaging_post` with `<@U…>` records the person; a post with no live mention records nobody.
// 2. A reply without a mention from a person who was not pinged reaches no agent.
// 3. A reply without a mention from the pinged person reaches the Slack Orchestrator, with the post
//    and the agent that posted it as the message that the reply answers. The thread gets its link.
// 4. After that, a reply without a mention still counts only from the pinged person. Another person
//    reaches the Orchestrator only with a mention.
// 5. A pinged person's first reply that mentions OpenBot also gets the post as context.
// 6. A thread reply that mentions OpenBot is left to its `app_mention` event.
// Writes .openbot-build/messaging-slack-ping-reply-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { type MessagingCredentials, MessagingService } from "../src/backend/messaging/messaging-service";
import type {
  MessagingAdapter,
  MessagingDriver,
  MessagingIngress,
  TransportSink,
} from "../src/backend/messaging/messaging-types";
import { slackInboundMessage } from "../src/backend/messaging/slack/slack-events";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/messaging-slack-ping-reply-e2e");
const REPORT = join(OUT, "report.json");
const root = await mkdtemp(join(tmpdir(), "openbot-slack-ping-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const WORKSPACE = "T-ping-e2e";
const BOT = "UBOT";
const CHANNEL = "C-design";
const PINGED = "UANNA";
const OTHER = "UTOM";

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
    "The real Slack Web API and the Signal relay: a fake Slack adapter and transport stand in for them.",
    "The quiet answer (NO_REPLY) of a real turn: a turn needs a signed-in provider, so no turn runs here.",
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

/** Polls a state of the services until it holds, or fails after the deadline. */
async function waitFor<T>(what: string, read: () => T | null | undefined, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((done) => setTimeout(done, 20));
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
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

const ingress: MessagingIngress = {
  acquire: () => () => {},
  state: () => "online",
  onState: () => () => {},
  handle: () => {},
  telegram: { available: () => false, call: unused, download: unused, upload: unused },
  reconnect: () => {},
  discord: unused,
  onDiscordRoutes: () => () => {},
};

/** Each call that OpenBot made to the fake Slack. */
const calls: { method: string; text?: string }[] = [];
let nextTs = 1_700_000_000;
function ts(): string {
  nextTs += 1;
  return `${nextTs}.000100`;
}

/** Records one call that posts, and gives the new post its ts. */
function posted(method: string, text: string): string {
  calls.push({ method, text });
  return ts();
}
let sink: TransportSink | null = null;

const adapter: MessagingAdapter = {
  platform: "slack",
  identify: () =>
    Effect.succeed({
      workspaceId: WORKSPACE,
      workspaceName: "Acme",
      botUserId: BOT,
      appId: "A-ping-e2e",
      missingScopes: [],
    }),
  post: (_target, body) => Effect.sync(() => posted("post", body.text)),
  edit: (_target, _id, body) => Effect.sync(() => void calls.push({ method: "edit", text: body.text })),
  remove: () => Effect.sync(() => void calls.push({ method: "remove" })),
  postPrivate: unused,
  react: () => Effect.sync(() => void calls.push({ method: "react" })),
  postAnswer: (_target, markdown) => Effect.sync(() => posted("postAnswer", markdown)),
  upload: unused,
  history: () => Effect.succeed([]),
  recent: unused,
  download: unused,
  authorName: (userId) => Effect.succeed(userId === PINGED ? "Anna" : "Tom"),
  placeName: () => Effect.succeed("#design"),
  places: unused,
  mention: (userId) => `<@${userId}>`,
};

const driver: MessagingDriver = {
  platform: "slack",
  requiredCredential: "botToken",
  createAdapter: () => adapter,
  createTransport: () => ({
    start: (started) => {
      sink = started;
      started.state("connected");
    },
    reconnect: () => {},
    stop: () => Effect.void,
  }),
};

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

/** One Slack Events API payload of a person's message, parsed by the real Slack event parser. */
function event(type: "message" | "app_mention", user: string, threadTs: string, text: string) {
  return slackInboundMessage(
    {
      type: "event_callback",
      team_id: WORKSPACE,
      event: { type, channel: CHANNEL, channel_type: "channel", user, ts: ts(), thread_ts: threadTs, text },
    },
    WORKSPACE,
    BOT,
  );
}

function deliver(message: ReturnType<typeof event>): string {
  assert.ok(message, "The Slack event parser dropped a message that addresses OpenBot.");
  assert.ok(sink, "The Slack transport did not start.");
  sink.message(message);
  return message.dedupKey;
}

const credentials = memoryCredentials();
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
await runCauseEffect(sidebar.initialize());
// The stores only: `AgentService.initialize` would start the provider CLIs, which no step needs.
await runCauseEffect(store.initialize());
await runCauseEffect(mailbox.initialize());
const agents = new AgentService({ store, mailbox, browser, sidebarLayout: sidebar });
const record = agents.messaging.store.ensureConnection("slack", WORKSPACE, "Acme");
agents.messaging.store.updateConnection(record.connectionId, { enabled: true });
await runCauseEffect(credentials.set(record.connectionId, { botToken: "fake-bot-token-for-ping-e2e" }));
const messaging = new MessagingService({
  threads: agents.messaging,
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
  drivers: [driver],
  downloadsRoot: join(userData, "messaging-downloads"),
  ingress,
  sidebar,
});

const pingRows = () =>
  database.connection
    .prepare("SELECT thread_key, user_id, agent_id, text FROM projection_messaging_pings ORDER BY user_id")
    .all()
    .map((row) => ({ ...row }));
const delivery = (dedupKey: string) => mailbox.deliveryForKey(`messaging:${record.connectionId}:${dedupKey}`);

async function post(agentId: string, text: string): Promise<{ messageId: string }> {
  const response = await runCauseEffect(
    agents.messaging.outboundTool(
      agentId,
      { threadId: `thread-${agentId}`, turnId: `turn-${agentId}` },
      "messaging_post",
      { connection: record.connectionId, place: CHANNEL, text },
      () => Effect.succeed([]),
    ),
  );
  const item = response.contentItems[0];
  assert.ok(item && "text" in item, "The post has no tool result.");
  const result = JSON.parse(item.text);
  assert.ok(isDynamicRecord(result) && isString(result.messageId), `The post failed: ${item.text}`);
  assert.equal(result.ping, undefined, "The tool result shows the pinged people to the agent.");
  return { messageId: result.messageId };
}

try {
  await runCauseEffect(messaging.start());
  const orchestrator = await runCauseEffect(messaging.addOrchestrator("slack", { workspaceId: WORKSPACE }));
  const research = await runCauseEffect(
    agents.createAgentProfile({ name: "Research", description: "", avatarSeed: "research", avatarHue: null }),
  );
  let thread = "";
  // Read again after a later reply arrives: a reply that passed the check reaches the mailbox only after
  // its name lookups, so an early read alone cannot show that it was dropped.
  let dropped = "";

  await step("a post with a live mention records the person; other posts record nobody", async () => {
    await post(research.id, "Weekly report, no question. Ask `<@UCODE>` or see [<@ULINK>](https://e.x).");
    assert.deepEqual(pingRows(), [], "A post with no live mention recorded a ping.");
    const pinged = await post(research.id, `<@${PINGED}> which logo do we ship: A or B?`);
    thread = pinged.messageId;
    assert.deepEqual(pingRows(), [
      {
        thread_key: thread,
        user_id: PINGED,
        agent_id: research.id,
        text: `<@${PINGED}> which logo do we ship: A or B?`,
      },
    ]);
    return { thread, pings: pingRows() };
  });

  await step("a reply without a mention from a person who was not pinged reaches no agent", async () => {
    const before = calls.length;
    dropped = deliver(event("message", OTHER, thread, "nice"));
    assert.equal(delivery(dropped), null, "A reply of a person who was not pinged reached an agent.");
    assert.equal(agents.messaging.store.linkByKey(record.connectionId, CHANNEL, thread), null);
    assert.deepEqual(calls.slice(before), [], "OpenBot answered a reply that does not address it.");
    return { ignored: true };
  });

  await step("the pinged person's reply reaches the Orchestrator with the post as context", async () => {
    const key = deliver(event("message", PINGED, thread, "B, the blue one."));
    const queued = await waitFor("the delivery of the pinged person's reply", () => delivery(key));
    assert.equal(delivery(dropped), null, "A reply of a person who was not pinged reached an agent.");
    const link = agents.messaging.store.linkByKey(record.connectionId, CHANNEL, thread);
    assert.ok(link, "The thread has no link after the reply.");
    assert.equal(link.agentId, orchestrator.agentId, "The reply did not go to the Slack Orchestrator.");
    const origin = mailbox.messagingOrigin(queued.delivery.id);
    assert.deepEqual(origin?.replyTo, {
      authorName: "OpenBot, a post by your teammate Research",
      text: `<@${PINGED}> which logo do we ship: A or B?`,
      sentAt: origin?.replyTo?.sentAt,
    });
    assert.ok(queued.delivery.text.includes("B, the blue one."), "The delivery does not have the reply.");
    assert.equal(pingRows().length, 1, "The link deleted the pings that decide who the thread hears.");
    return { agentId: link.agentId, replyTo: origin?.replyTo };
  });

  await step("after the link, only the pinged person or a mention reaches the Orchestrator", async () => {
    const link = agents.messaging.store.linkByKey(record.connectionId, CHANNEL, thread);
    const before = calls.length;
    const ignored = deliver(event("message", OTHER, thread, "Agreed, B."));
    assert.equal(delivery(ignored), null, "A reply of a person who was not pinged reached the linked thread.");
    assert.deepEqual(calls.slice(before), [], "OpenBot answered a reply that does not address it.");
    const again = deliver(event("message", PINGED, thread, "Also make it bigger."));
    const queued = await waitFor("the delivery of the pinged person's second reply", () => delivery(again));
    const origin = mailbox.messagingOrigin(queued.delivery.id);
    assert.equal(origin?.linkId, link?.linkId, "The reply did not go to the thread's conversation.");
    assert.equal(origin?.replyTo, undefined, "A later reply got the post again.");
    const mention = deliver(event("app_mention", OTHER, thread, `<@${BOT}> agreed, B.`));
    const mentioned = await waitFor("the delivery of a mention in the thread", () => delivery(mention));
    assert.equal(mailbox.messagingOrigin(mentioned.delivery.id)?.linkId, link?.linkId);
    assert.equal(delivery(ignored), null, "A reply of a person who was not pinged reached the linked thread.");
    return { ignored: true, pingedReply: origin?.linkId, mention: "reached" };
  });

  await step("a pinged person's first reply with a mention also gets the post as context", async () => {
    const asked = await post(research.id, `<@${OTHER}> can you review the copy?`);
    const key = deliver(event("app_mention", OTHER, asked.messageId, `<@${BOT}> yes, it reads well`));
    const queued = await waitFor("the delivery of a pinged reply with a mention", () => delivery(key));
    const origin = mailbox.messagingOrigin(queued.delivery.id);
    assert.equal(
      origin?.replyTo?.text,
      `<@${OTHER}> can you review the copy?`,
      "The reply lost the post that it answers.",
    );
    return { replyTo: origin?.replyTo?.authorName };
  });

  await step("a thread reply that mentions OpenBot is left to its app_mention event", async () => {
    assert.equal(event("message", PINGED, thread, `<@${BOT}> also make it bigger`), null);
    assert.ok(event("app_mention", PINGED, thread, `<@${BOT}> also make it bigger`));
    return { messageEvent: null, appMention: "kept" };
  });

  report.passed = true;
} finally {
  await runCauseEffect(messaging.stop());
  await runCauseEffect(agents.stop());
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`Slack ping reply check passed. Report: ${REPORT}\n`);
