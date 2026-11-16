// Checks Discord embeds in the agent's `messaging_post` tool. The tool call goes through the real
// messaging threads, messaging service and Discord driver on a temporary profile, then through
// Signal's request decoder and API (`remote/api/src/discord-api.ts`) to a fake Discord REST client,
// which records the body that Discord would get. No provider, Gateway or network runs.
// `bun scripts/messaging-discord-embeds-e2e.ts`. Writes .openbot-build/messaging-discord-embeds-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  DISCORD_MESSAGE_TEXT_LIMIT,
  type DiscordApiErrorCode,
  type DiscordApiRequest,
} from "@openbot/contracts/signal-protocol/discord-api";
import { registerSecretValue } from "@openbot/logging";
import { Effect } from "effect";
import {
  type DiscordRestRequest,
  DiscordTransportError,
  decodeDiscordApiRequest,
  makeDiscordApi,
} from "../remote/api/src/discord-api";
import { DiscordState } from "../remote/api/src/discord-events";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { discordDriver } from "../src/backend/messaging/discord/discord-driver";
import { type MessagingCredentials, MessagingService } from "../src/backend/messaging/messaging-service";
import { MessagingThreads } from "../src/backend/messaging/messaging-threads";
import {
  DiscordApiError,
  MessagingAdapterError,
  type MessagingIngress,
} from "../src/backend/messaging/messaging-types";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/messaging-discord-embeds-e2e");
const REPORT = join(OUT, "report.json");
const root = await mkdtemp(join(tmpdir(), "openbot-messaging-discord-embeds-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const APP = "300000000000000001";
const GUILD = "100000000000000001";
const CHANNEL = "110000000000000001";
const SECRET = "embed-secret-0f3c9a7d51";
registerSecretValue(SECRET);

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
    "Discord itself: a fake REST client records the body, so Discord's rendering and its own checks of an embed are not run.",
    "A post with embeds to a Slack, Telegram or WhatsApp place: this check connects only Discord.",
    "An agent turn: the check calls the tool as the tool router does, and no provider runs.",
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
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

/** The requests that the host sent to Signal, and the bodies that Signal sent to Discord. */
const hostRequests: DiscordApiRequest[] = [];
const posts: DynamicRecord[] = [];
let nextMessageId = 600000000000000000n;

const rest = {
  request: (input: DiscordRestRequest) =>
    Effect.suspend(() => {
      if (input.method === "POST" && input.route === `/channels/${CHANNEL}/messages`) {
        posts.push(record(JSON.parse(JSON.stringify(input.body))));
        nextMessageId += 1n;
        return Effect.succeed({ id: nextMessageId.toString() });
      }
      return Effect.fail(new DiscordTransportError({ status: 404 }));
    }),
};

const signal = new DiscordState(APP);
const gateway = (t: string, d: unknown): Parameters<DiscordState["handle"]>[0] =>
  JSON.parse(JSON.stringify({ op: 0, s: 1, t, d }));
signal.handle(
  gateway("READY", {
    v: 10,
    user: { id: APP, username: "OpenBot", bot: true },
    application: { id: APP, flags: 0 },
    guilds: [{ id: GUILD, unavailable: true }],
    session_id: "session",
    resume_gateway_url: "wss://gateway.discord.gg",
    shard: [0, 1],
  }),
);
signal.handle(
  gateway("GUILD_CREATE", { id: GUILD, name: "Nightly", channels: [{ id: CHANNEL, type: 0, name: "general" }] }),
);
const signalApi = makeDiscordApi(rest, signal);

/** The relay as Signal drives it: the request goes over JSON and through Signal's own decoder. */
const ingress: MessagingIngress = {
  acquire: () => () => {},
  state: () => "online",
  onState: () => () => {},
  handle: () => {},
  telegram: { available: () => false, call: unused, download: unused, upload: unused },
  reconnect: () => {},
  onDiscordRoutes: () => () => {},
  onLinkedRoutes: () => () => {},
  discord: (request, decode) => {
    hostRequests.push(request);
    const decoded = decodeDiscordApiRequest(JSON.parse(JSON.stringify(request)));
    const refused = (code: DiscordApiErrorCode) =>
      Effect.fail(new MessagingAdapterError({ cause: new DiscordApiError(request.op, code) }));
    if (!decoded) return refused("invalid_request");
    return signalApi.call(decoded, null).pipe(
      Effect.map((result) => decode(JSON.parse(JSON.stringify(result)))),
      Effect.catch((failure) => refused(failure.code)),
    );
  },
};

const values = new Map<string, Record<string, string>>();
const credentials: MessagingCredentials = {
  keys: () => [...values.keys()],
  status: (connectionId) => (values.has(connectionId) ? "saved" : "missing"),
  get: (connectionId) => values.get(connectionId) ?? null,
  set: (connectionId, value) => Effect.sync(() => void values.set(connectionId, value)),
  clear: (connectionId) => Effect.sync(() => void values.delete(connectionId)),
  retain: () => Effect.void,
};

async function boot<T>(use: (threads: MessagingThreads) => Promise<T>): Promise<T> {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const agents = new AgentService({ store, mailbox, browser, sidebarLayout: sidebar });
  const threads = new MessagingThreads(store.database, mailbox, {
    schedule: () => {},
    queueChanged: () => {},
    busy: () => false,
    interrupt: unused,
    forgetThread: () => Effect.void,
    ownChat: () => false,
    contextSession: () => null,
    progressUpdates: () => null,
  });
  const messaging = new MessagingService({
    threads,
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
    drivers: [discordDriver({ ingress })],
    downloadsRoot: join(userData, "messaging-downloads"),
    ingress,
    sidebar,
  });
  await runCauseEffect(messaging.start());
  try {
    return await use(threads);
  } finally {
    await runCauseEffect(messaging.stop());
    await runCauseEffect(agents.stop());
    database.close();
  }
}

function record(value: unknown): DynamicRecord {
  assert.ok(isDynamicRecord(value), "The tool result is not an object.");
  return value;
}

/** One `messaging_post` call, as the tool router makes it. Returns the result and the new bodies. */
async function post(threads: MessagingThreads, connection: string, args: DynamicRecord) {
  const before = { requests: hostRequests.length, posts: posts.length };
  const response = await runCauseEffect(
    // The router passes the calling agent; a Discord post records no pings, so any id does.
    threads.outboundTool(
      "agent-embeds-e2e",
      { threadId: "thread-embeds-e2e", turnId: "turn-embeds-e2e" },
      "messaging_post",
      { connection, place: CHANNEL, ...args },
      () => Effect.succeed([]),
    ),
  );
  const text = response.contentItems[0]?.text ?? "{}";
  return {
    success: response.success,
    result: record(JSON.parse(text)),
    requests: hostRequests.slice(before.requests),
    bodies: posts.slice(before.posts),
  };
}

const embed = {
  title: "  Nightly report  ",
  description: `All checks passed. Key ${SECRET} is set.`,
  url: "https://openbot.run/report",
  color: 0x5865f2,
  timestamp: "2026-11-09T10:00:00.000Z",
  author: { name: "OpenBot", icon_url: "https://openbot.run/icon.png" },
  footer: { text: "Routine: nightly" },
  thumbnail: { url: "https://openbot.run/thumb.png" },
  image: { url: "https://openbot.run/chart.png" },
  fields: [
    { name: "Passed", value: "41", inline: true },
    { name: "Failed", value: "0", inline: true },
  ],
};

try {
  await boot(async (threads) => {
    const record = threads.store.ensureConnection("discord", GUILD, "Nightly");
    threads.store.updateConnection(record.connectionId, { enabled: true });
    await runCauseEffect(credentials.set(record.connectionId, { guildId: GUILD, guildName: "Nightly", appId: APP }));
  });

  await boot(async (threads) => {
    const connection = threads.store.connections()[0]?.connectionId ?? "";
    assert.ok(connection, "The Discord connection is missing.");

    await step("text and embeds post as one message, with each secret masked", async () => {
      const sent = await post(threads, connection, {
        text: "Report of the night",
        embeds: [embed, { description: "Second" }],
      });
      assert.ok(sent.success, JSON.stringify(sent.result));
      assert.equal(sent.bodies.length, 1);
      const body = sent.bodies[0] ?? {};
      assert.equal(body.content, "Report of the night");
      assert.deepEqual(body.embeds, [
        { ...embed, title: "Nightly report", description: "All checks passed. Key [redacted] is set." },
        { description: "Second" },
      ]);
      assert.ok(!JSON.stringify(sent.bodies).includes(SECRET), "A secret reached Discord.");
      assert.match(
        String(sent.result.url),
        new RegExp(`^https://discord\\.com/channels/${GUILD}/${CHANNEL}/[0-9]+$`, "u"),
      );
      return { embeds: 2 };
    });

    await step("embeds without text post with no content", async () => {
      const sent = await post(threads, connection, { embeds: [{ title: "Only an embed" }] });
      assert.ok(sent.success, JSON.stringify(sent.result));
      assert.equal(sent.bodies.length, 1);
      assert.equal("content" in (sent.bodies[0] ?? {}), false);
      assert.deepEqual(sent.bodies[0]?.embeds, [{ title: "Only an embed" }]);
      return { content: false };
    });

    await step("a plain post sends no embeds key, so an older Signal accepts it", async () => {
      const sent = await post(threads, connection, { text: "Plain text", embeds: [] });
      assert.ok(sent.success, JSON.stringify(sent.result));
      assert.equal(sent.requests.length, 1);
      assert.equal("embeds" in (sent.requests[0] ?? {}), false);
      assert.equal("embeds" in (sent.bodies[0] ?? {}), false);
      return { embedsKey: false };
    });

    await step("a long text goes in more than one post, and the embeds go on the first", async () => {
      const long = Array.from({ length: 60 }, (_, index) => `Line ${index} ${"x".repeat(60)}`).join("\n");
      assert.ok(long.length > DISCORD_MESSAGE_TEXT_LIMIT);
      const sent = await post(threads, connection, { text: long, embeds: [{ title: "Summary" }] });
      assert.ok(sent.success, JSON.stringify(sent.result));
      assert.ok(sent.bodies.length > 1, "The long text was not split.");
      assert.deepEqual(sent.bodies[0]?.embeds, [{ title: "Summary" }]);
      assert.ok(
        sent.bodies.slice(1).every((body) => !("embeds" in body)),
        "A later part has embeds.",
      );
      return { posts: sent.bodies.length };
    });

    await step("Signal refuses the embeds of a long text, and nothing is posted", async () => {
      const long = Array.from({ length: 60 }, (_, index) => `Line ${index} ${"x".repeat(60)}`).join("\n");
      // A link that the host accepts and that a mask breaks, as `redactEmbed` can.
      const sent = await post(threads, connection, {
        text: long,
        embeds: [{ title: "Report", url: `https://openbot.run/${SECRET}` }],
      });
      assert.equal(sent.success, false, "A post with a broken link was accepted.");
      assert.equal(sent.requests.length, 1);
      assert.equal(sent.bodies.length, 0, "A part of the text was posted.");
      return { posted: 0 };
    });

    await step("the tool refuses an invalid embed and posts nothing", async () => {
      const cases: DynamicRecord[] = [
        { embeds: [] },
        { embeds: [{}] },
        { embeds: [{ title: "Link", url: "javascript:alert(1)" }] },
        { embeds: [{ title: "Color", color: 0x1000000 }] },
        { embeds: [{ title: "Unknown", video: { url: "https://openbot.run/v.mp4" } }] },
        { embeds: Array.from({ length: 11 }, () => ({ title: "Many" })) },
        { embeds: [{ description: "d".repeat(4_000) }, { description: "d".repeat(2_001) }] },
      ];
      const errors: string[] = [];
      for (const args of cases) {
        const sent = await post(threads, connection, args);
        assert.equal(sent.success, false, `Accepted ${JSON.stringify(args).slice(0, 80)}`);
        assert.equal(sent.requests.length, 0, "A refused call reached Signal.");
        errors.push(String(sent.result.error));
      }
      assert.ok(errors[0]?.includes("Give text, files, embeds, or more than one."));
      assert.ok(errors[1]?.includes("An embed needs a title"));
      assert.ok(errors[6]?.includes("longer than 6000 characters"));
      return { refused: cases.length };
    });
  });

  await step("Signal refuses an invalid embed that a host sends", async () => {
    const base = { op: "createMessage", guildId: GUILD, channelId: CHANNEL, content: "", replyTo: null, buttons: [] };
    assert.ok(decodeDiscordApiRequest({ ...base, embeds: [{ title: "ok" }] }), "A valid embed was refused.");
    for (const request of [
      base,
      { ...base, embeds: [] },
      { ...base, embeds: [{}] },
      { ...base, embeds: [{ title: "x", image: { url: "file:///etc/passwd" } }] },
      { ...base, embeds: [{ title: "x", fields: Array.from({ length: 26 }, () => ({ name: "n", value: "v" })) }] },
      { ...base, embeds: [{ title: "x", extra: true }] },
    ])
      assert.equal(decodeDiscordApiRequest(request), null, `Signal accepted ${JSON.stringify(request).slice(0, 120)}`);
    return { refused: 6 };
  });

  report.passed = true;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`Discord embeds check passed. Report: ${REPORT}\n`);
