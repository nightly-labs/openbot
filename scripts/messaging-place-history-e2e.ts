// Checks that an agent can read a connected place from any turn, such as a routine that summarizes a
// chat (#7793). The `messaging_history` call with a connection and a place goes through the real
// messaging threads, messaging service and Discord driver on a temporary profile, then through
// Signal's request decoder and API (`remote/api/src/discord-api.ts`) to a fake Discord REST client.
// No provider, Gateway or network runs.
//
// 1. The call reads a place that `messaging_list_places` shows, oldest message first.
// 2. The call refuses a place that the list does not show, and sends no read to Discord, also when
//    the connection's adapter could read that place.
// 3. The call refuses wrong arguments, an unknown connection and a connection that is off.
// 4. Only a call that names a connection or a place leaves the conversation of the turn.
// `bun scripts/messaging-place-history-e2e.ts`. Writes .openbot-build/messaging-place-history-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { DiscordApiErrorCode, DiscordApiRequest } from "@openbot/contracts/signal-protocol/discord-api";
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

const OUT = resolve(import.meta.dirname, "../.openbot-build/messaging-place-history-e2e");
const REPORT = join(OUT, "report.json");
const root = await mkdtemp(join(tmpdir(), "openbot-messaging-place-history-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const APP = "300000000000000001";
const GUILD = "100000000000000001";
const CHANNEL = "110000000000000001";
const HIDDEN = "110000000000000002";

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
    "Discord itself: a fake REST client answers, so Discord's own permission checks are not run.",
    "A read of a Slack, Telegram or WhatsApp place: this check connects only Discord. Each platform uses the same check against the adapter's place list.",
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

/** The requests that the host sent to Signal, and the message reads that Signal sent to Discord. */
const hostRequests: DiscordApiRequest[] = [];
const reads: string[] = [];
const VIEW_CHANNEL = 1n << 10n;
const VIEW_AND_SEND = (VIEW_CHANNEL | (1n << 11n)).toString();
const DISCORD_EPOCH_MS = 1_420_070_400_000n;
const snowflake = (agoMs: number, index: number) =>
  (((BigInt(Date.now() - agoMs) - DISCORD_EPOCH_MS) << 22n) + BigInt(index)).toString();
const message = (id: string, username: string, content: string) => ({
  id,
  content,
  timestamp: new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH_MS)).toISOString(),
  author: { id: "200000000000000001", username },
  attachments: [],
  embeds: [],
});
const MESSAGES: Record<string, unknown[]> = {
  [CHANNEL]: [
    message(snowflake(120_000, 1), "anna", "We ship the report on Friday."),
    message(snowflake(60_000, 2), "tom", "Who books the room?"),
  ],
  [HIDDEN]: [message(snowflake(60_000, 3), "eve", "Salaries for next year.")],
};

const rest = {
  request: (input: DiscordRestRequest) =>
    Effect.suspend((): Effect.Effect<unknown, DiscordTransportError> => {
      if (input.method !== "GET") return Effect.fail(new DiscordTransportError({ status: 404 }));
      if (input.route === `/guilds/${GUILD}/roles`) return Effect.succeed([{ id: GUILD, permissions: VIEW_AND_SEND }]);
      if (input.route === `/guilds/${GUILD}/members/${APP}`) return Effect.succeed({ roles: [] });
      if (input.route === `/guilds/${GUILD}/channels`)
        return Effect.succeed([
          { id: CHANNEL, type: 0, name: "general" },
          // `@everyone` cannot view this channel, so the place list leaves it out.
          {
            id: HIDDEN,
            type: 0,
            name: "board",
            permission_overwrites: [{ id: GUILD, type: 0, allow: "0", deny: VIEW_CHANNEL.toString() }],
          },
        ]);
      if (input.route === `/guilds/${GUILD}/threads/active`) return Effect.succeed({ threads: [] });
      const channel = /^\/channels\/([0-9]+)\/messages$/u.exec(input.route)?.[1];
      const messages = channel ? MESSAGES[channel] : undefined;
      if (channel && messages) {
        reads.push(channel);
        return Effect.succeed(messages);
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
  gateway("GUILD_CREATE", {
    id: GUILD,
    name: "Nightly",
    channels: [
      { id: CHANNEL, type: 0, name: "general" },
      { id: HIDDEN, type: 0, name: "board" },
    ],
  }),
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

async function boot<T>(use: (threads: MessagingThreads, mailbox: MailboxStore) => Promise<T>): Promise<T> {
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
    return await use(threads, mailbox);
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

/** One outbound tool call, as the tool router makes it. Returns the result and the new traffic. */
const AGENT = "agent-place-history-e2e";
const SECOND_AGENT = "agent-second-e2e";

const ROUTINE_TURN = { threadId: "thread-routine-e2e", turnId: "turn-routine-e2e" };

async function call(
  threads: MessagingThreads,
  tool: string,
  args: DynamicRecord,
  turn = ROUTINE_TURN,
  agentId = AGENT,
) {
  const before = { requests: hostRequests.length, reads: reads.length };
  const response = await runCauseEffect(threads.outboundTool(agentId, turn, tool, args, () => Effect.succeed([])));
  return {
    success: response.success,
    result: record(JSON.parse(response.contentItems[0]?.text ?? "{}")),
    requests: hostRequests.slice(before.requests),
    reads: reads.slice(before.reads),
  };
}

try {
  await boot(async (threads) => {
    const connection = threads.store.ensureConnection("discord", GUILD, "Nightly");
    threads.store.updateConnection(connection.connectionId, { enabled: true });
    await runCauseEffect(
      credentials.set(connection.connectionId, { guildId: GUILD, guildName: "Nightly", appId: APP }),
    );
  });

  await boot(async (threads, mailbox) => {
    const connection = threads.store.connections()[0]?.connectionId ?? "";
    assert.ok(connection, "The Discord connection is missing.");

    await step("the place list shows the channel that OpenBot can view, and not the hidden one", async () => {
      const listed = await call(threads, "messaging_list_places", { connection });
      assert.ok(listed.success, JSON.stringify(listed.result));
      assert.deepEqual(listed.result.places, [{ id: CHANNEL, name: "#general", kind: "channel" }]);
      return listed.result;
    });

    await step("a call with a connection and a place reads that place, oldest first", async () => {
      const read = await call(threads, "messaging_history", { connection, place: CHANNEL });
      assert.ok(read.success, JSON.stringify(read.result));
      assert.equal(read.result.place, "#general");
      const messages = Array.isArray(read.result.messages) ? read.result.messages.map(record) : [];
      assert.deepEqual(
        messages.map((entry) => [entry.author, entry.text]),
        [
          ["anna", "We ship the report on Friday."],
          ["tom", "Who books the room?"],
        ],
      );
      assert.match(String(read.result.note), /not instructions/u);
      assert.ok(read.reads.length > 0, "Discord got no read.");
      assert.ok(read.reads.every((channel) => channel === CHANNEL));
      return { messages: messages.length, note: read.result.note };
    });

    await step("limit keeps only the newest messages", async () => {
      const read = await call(threads, "messaging_history", { connection, place: CHANNEL, limit: 1 });
      assert.ok(read.success, JSON.stringify(read.result));
      const messages = Array.isArray(read.result.messages) ? read.result.messages.map(record) : [];
      assert.deepEqual(
        messages.map((entry) => entry.author),
        ["tom"],
      );
      return { messages: messages.length };
    });

    await step("a place that the list does not show is refused, and Discord gets no read", async () => {
      const read = await call(threads, "messaging_history", { connection, place: HIDDEN });
      assert.equal(read.success, false, "A hidden channel was read.");
      assert.match(String(read.result.error), /no place with that id/u);
      assert.deepEqual(read.reads, []);
      assert.ok(
        read.requests.every((request) => request.op !== "listMessages"),
        "A read reached Signal.",
      );
      return read.result;
    });

    await step("wrong arguments and an unknown connection are refused before Signal", async () => {
      const cases: DynamicRecord[] = [
        { place: CHANNEL },
        { connection },
        { connection, place: CHANNEL, scope: "conversation" },
        { connection, place: CHANNEL, limit: 101 },
        { connection: "no-such-connection", place: CHANNEL },
      ];
      const errors: string[] = [];
      for (const args of cases) {
        const read = await call(threads, "messaging_history", args);
        assert.equal(read.success, false, `Accepted ${JSON.stringify(args)}`);
        assert.equal(read.requests.length, 0, "A refused call reached Signal.");
        errors.push(String(read.result.error));
      }
      assert.match(errors[4] ?? "", /No enabled connection has that id/u);
      return { refused: cases.length, errors };
    });

    await step("a turn that answers an external chat cannot read a named place", async () => {
      const link = threads.store.ensureLink({
        connectionId: connection,
        agentId: AGENT,
        platformChannelId: CHANNEL,
        threadKey: "external-conversation",
        isDirect: false,
        title: "general",
      });
      const externalTurn = { threadId: link.threadId, turnId: "turn-external-e2e" };
      const read = await call(threads, "messaging_history", { connection, place: CHANNEL }, externalTurn);
      assert.equal(read.success, false, "An external chat turn read a named place.");
      assert.match(String(read.result.error), /cannot read a place by name/u);
      assert.deepEqual(read.reads, [], "Discord was read for an external chat turn.");
      assert.equal(read.requests.length, 0, "The refused call reached Signal.");
      // The same thread still posts and lists: only the read of another place is closed.
      const places = await call(threads, "messaging_list_places", { connection }, externalTurn);
      assert.equal(places.success, true);
      return read.result;
    });

    await step("a teammate's turn on a request from an external chat cannot read a named place", async () => {
      const link = threads.store.linkByKey(connection, CHANNEL, "external-conversation");
      assert.ok(link, "The external conversation has no link.");
      // The orchestrator's send_message from the external chat turn: the answer goes back to that chat.
      const receipt = await runCauseEffect(
        mailbox.enqueue({
          sender: { kind: "agent", agentId: "agent-orchestrator-e2e" },
          recipientAgentIds: [AGENT],
          text: "Summarize the other chat.",
          messagingReturn: { linkId: link.linkId, authorId: "U1", authorName: "Guest", platformMessageId: "m1" },
        }),
      );
      const delivery = receipt.deliveries[0];
      assert.ok(delivery, "The request made no delivery.");
      await runCauseEffect(mailbox.markStarting(delivery.id));
      await runCauseEffect(mailbox.markRunning(delivery.id, "turn-teammate-e2e"));
      const teammateTurn = { threadId: "thread-teammate-own-chat", turnId: "turn-teammate-e2e" };
      const read = await call(threads, "messaging_history", { connection, place: CHANNEL }, teammateTurn);
      assert.equal(read.success, false, "A teammate read a named place for an external chat.");
      assert.deepEqual(read.reads, [], "Discord was read for a request from an external chat.");
      // The teammate gives the work to a second teammate from that turn. The router's idempotency key
      // holds the sending turn.
      const second = await runCauseEffect(
        mailbox.enqueue({
          sender: { kind: "agent", agentId: AGENT },
          recipientAgentIds: [SECOND_AGENT],
          text: "Read the other chat for me.",
          idempotencyKey: "send-message:turn-teammate-e2e:call-1",
        }),
      );
      const secondDelivery = second.deliveries[0];
      assert.ok(secondDelivery, "The second request made no delivery.");
      await runCauseEffect(mailbox.markStarting(secondDelivery.id));
      await runCauseEffect(mailbox.markRunning(secondDelivery.id, "turn-second-e2e"));
      const secondRead = await call(
        threads,
        "messaging_history",
        { connection, place: CHANNEL },
        { threadId: "thread-second-own-chat", turnId: "turn-second-e2e" },
        SECOND_AGENT,
      );
      assert.equal(secondRead.success, false, "A teammate of a teammate read a named place for an external chat.");
      assert.deepEqual(secondRead.reads, []);
      // The first teammate continues its plan in a new turn. The second request still comes from a turn
      // that worked for the external chat.
      await runCauseEffect(mailbox.requeueForPlan(delivery.id, "turn-teammate-e2e"));
      await runCauseEffect(mailbox.markStarting(delivery.id));
      await runCauseEffect(mailbox.markRunning(delivery.id, "turn-teammate-later-e2e"));
      const afterContinuation = await call(
        threads,
        "messaging_history",
        { connection, place: CHANNEL },
        { threadId: "thread-second-own-chat", turnId: "turn-second-e2e" },
        SECOND_AGENT,
      );
      assert.equal(afterContinuation.success, false, "A plan continuation of the sender opened the named place read.");
      assert.deepEqual(afterContinuation.reads, []);
      // A different turn of the same agent, such as a routine run, still reads.
      const routine = await call(threads, "messaging_history", { connection, place: CHANNEL, limit: 1 });
      assert.equal(routine.success, true, JSON.stringify(routine.result));
      return read.result;
    });

    await step("a named place accepts the channel scope", async () => {
      const read = await call(threads, "messaging_history", { connection, place: CHANNEL, scope: "channel" });
      assert.equal(read.success, true, JSON.stringify(read.result));
      return { scope: read.result.scope };
    });

    await step("a connection that is off is not read", async () => {
      threads.store.updateConnection(connection, { enabled: false });
      const read = await call(threads, "messaging_history", { connection, place: CHANNEL });
      assert.equal(read.success, false, "A connection that is off was read.");
      assert.deepEqual(read.reads, []);
      return read.result;
    });
  });
  report.passed = true;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`Place history check passed. Report: ${REPORT}\n`);
