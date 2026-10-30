// Checks two Discord servers on one OpenBot server, the role list of a Discord server, the
// replied-to message as context, a forwarded message as context, and an earlier image posted without a mention as context. A Gateway event goes through Signal's normalizer
// (`remote/api/src/discord-events.ts`), a JSON round trip and the host's decoder, into the real
// Discord driver and messaging service on a temporary profile. Signal's API (`makeDiscordApi`) runs
// over a fake Discord REST client. No agent turn runs: the check reads the prompt that a turn would get.
// `bun scripts/messaging-discord-access-e2e.ts`. Writes .openbot-build/messaging-discord-access-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DISCORD_GATEWAY_INTENTS, DISCORD_MESSAGE_CONTENT_INTENT } from "@openbot/contracts/discord-app";
import { isDiscordRoleList } from "@openbot/contracts/ipc";
import {
  decodeDiscordApiError,
  decodeDiscordDelivery,
  decodeDiscordHistory,
} from "@openbot/contracts/signal-protocol/discord-api";
import { Effect } from "effect";
import { type DiscordRestRequest, DiscordTransportError, makeDiscordApi } from "../remote/api/src/discord-api";
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
  type IngressHandler,
  MessagingAdapterError,
  type MessagingIngress,
} from "../src/backend/messaging/messaging-types";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { parseSetDiscordAccessInput } from "../src/main/ipc/messaging-inputs";

const OUT = resolve(import.meta.dirname, "../.openbot-build/messaging-discord-access-e2e");
const REPORT = join(OUT, "report.json");
const root = await mkdtemp(join(tmpdir(), "openbot-messaging-discord-access-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const APP = "300000000000000001";
const GUILD_ONE = "100000000000000001";
// This guild's Signal is older than role lists: it refuses `listRoles`.
const GUILD_TWO = "100000000000000002";
const CHANNEL_ONE = "110000000000000001";
const CHANNEL_TWO = "110000000000000002";
const MAINTAINERS = "400000000000000001";
const MEMBERS = "400000000000000002";
const LONG_ROLE = "400000000000000003";
const ANA = "500000000000000001";
const BOB = "500000000000000002";
const KAMIL = "500000000000000003";
// One author for each later queued mention: the service refuses a third waiting message of one author.
const EVA = "500000000000000004";
const OLA = "500000000000000005";
const IGA = "500000000000000006";
const ULA = "500000000000000007";
const TOMEK = "500000000000000008";
const OLEK = "500000000000000009";
const NINA = "500000000000000010";
const PIOTR = "500000000000000011";
const RITA = "500000000000000012";

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
    "The Discord Gateway and REST API: a fake REST client stands in for Discord, so the role IDs and the replied-to text in a real MESSAGE_CREATE are not checked here.",
    "The Signal ingress socket and the Gateway intent fallback (close code 4014): the check calls Signal's API and normalizer in this process.",
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

/** A Gateway event as Discord sends it. JSON, as on the wire. */
function gateway(t: string, d: unknown): Parameters<DiscordState["handle"]>[0] {
  return JSON.parse(JSON.stringify({ op: 0, s: 1, t, d }));
}

/** What the fake Discord REST client received, and a wait for one call. */
const calls: DiscordRestRequest[] = [];
const waiters: Array<{ match: (call: DiscordRestRequest) => boolean; resolve: () => void }> = [];
let nextMessageId = 600000000000000000n;
/** One channel message as Discord's REST API gives it. */
interface RestMessage {
  id: string;
  content: string;
  timestamp: string;
  author: { id: string; username: string };
  attachments: { id: string; filename: string; content_type: string; size: number; url: string }[];
  /** A forward has no text or files of its own: they are in its snapshot. */
  message_reference?: { type: number; message_id: string };
  message_snapshots?: { message: { content: string; attachments: RestMessage["attachments"] } }[];
}
/** The earlier messages of CHANNEL_ONE that `listMessages` gives. */
const channelOne: RestMessage[] = [];

/** Fails after 15 seconds, so a call that never comes fails the check instead of holding it. */
function waitForCall(match: (call: DiscordRestRequest) => boolean): Promise<void> {
  if (calls.some(match)) return Promise.resolve();
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("The expected Discord call did not come.")), 15_000);
    waiters.push({
      match,
      resolve: () => {
        clearTimeout(timer);
        done();
      },
    });
  });
}

/** Discord's REST API for the calls this check makes. */
const rest = {
  request: (input: DiscordRestRequest) =>
    Effect.suspend(() => {
      calls.push(input);
      for (const waiter of waiters.splice(0)) {
        if (waiter.match(input)) waiter.resolve();
        else waiters.push(waiter);
      }
      const route = input.route;
      if (input.method === "POST" && /^\/channels\/[0-9]+\/messages$/u.test(route)) {
        nextMessageId += 1n;
        return Effect.succeed({ id: nextMessageId.toString() });
      }
      if (route.includes("/reactions/")) return Effect.succeed({});
      if (route === `/channels/${CHANNEL_ONE}/messages`) {
        const after = BigInt(input.query?.get("after") ?? "0");
        return Effect.succeed(channelOne.filter((message) => BigInt(message.id) > after));
      }
      if (/^\/channels\/[0-9]+\/messages$/u.test(route)) return Effect.succeed([]);
      const member = /^\/guilds\/[0-9]+\/members\/([0-9]+)$/u.exec(route);
      if (member) {
        const names: Record<string, string> = {
          [ANA]: "Ana",
          [BOB]: "Bob",
          [KAMIL]: "Kamil",
          [EVA]: "Eva",
          [OLA]: "Ola",
          [IGA]: "Iga",
          [ULA]: "Ula",
          [TOMEK]: "tomek",
          [OLEK]: "Olek",
        };
        const id = member[1] ?? "";
        return Effect.succeed({ nick: null, user: { id, username: names[id] ?? id } });
      }
      if (route === `/guilds/${GUILD_ONE}/roles`)
        return Effect.succeed([
          { id: GUILD_ONE, name: "@everyone", position: 0 },
          { id: MEMBERS, name: "Members", position: 1 },
          { id: MAINTAINERS, name: "Maintainers", position: 2 },
          { id: "400000000000000009", name: "OpenBot", position: 3, managed: true },
          // 60 emoji: 60 characters for Discord, 120 UTF-16 units.
          { id: LONG_ROLE, name: "🦊".repeat(60), position: 0 },
        ]);
      return Effect.fail(new DiscordTransportError({ status: 404 }));
    }),
};

// Signal's state and API, after the Gateway's READY and the two guilds.
const signal = new DiscordState(APP);
signal.handle(
  gateway("READY", {
    v: 10,
    user: { id: APP, username: "OpenBot", bot: true },
    application: { id: APP, flags: 0 },
    guilds: [
      { id: GUILD_ONE, unavailable: true },
      { id: GUILD_TWO, unavailable: true },
    ],
    session_id: "session",
    resume_gateway_url: "wss://gateway.discord.gg",
    shard: [0, 1],
  }),
);
for (const [guildId, channelId, name] of [
  [GUILD_ONE, CHANNEL_ONE, "Nightly"],
  [GUILD_TWO, CHANNEL_TWO, "Labs"],
] as const)
  signal.handle(
    gateway("GUILD_CREATE", { id: guildId, name, channels: [{ id: channelId, type: 0, name: "general" }] }),
  );
const signalApi = makeDiscordApi(rest, signal);

/** The relay as Signal drives it, with Signal's API answering the host's Discord calls. */
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
  onDiscordRoutes: () => () => {},
  discord: (request, decode) => {
    // An older Signal does not know `listRoles` and refuses it as an invalid request.
    if (request.op === "listRoles" && request.guildId === GUILD_TWO)
      return Effect.fail(new MessagingAdapterError({ cause: new DiscordApiError(request.op, "invalid_request") }));
    return signalApi.call(request, null).pipe(
      Effect.map((result) => decode(JSON.parse(JSON.stringify(result)))),
      Effect.mapError((failure) => {
        const body = decodeDiscordApiError({ error: { code: failure.code } });
        return new MessagingAdapterError({ cause: new DiscordApiError(request.op, body?.code ?? "discord_failed") });
      }),
    );
  },
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
  const threads = new MessagingThreads(store.database, mailbox, {
    schedule: () => {},
    queueChanged: () => {},
    busy: () => false,
    interrupt: unused,
    forgetThread: () => Effect.void,
    ownChat: () => false,
    contextSession: () => null,
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
    return await use({ messaging, threads, mailbox });
  } finally {
    await runCauseEffect(messaging.stop());
    await runCauseEffect(agents.stop());
    database.close();
  }
}

interface Mention {
  id: string;
  guildId: string;
  channelId: string;
  authorId: string;
  authorName: string;
  roles?: string[];
  content: string;
  replyTo?: {
    id: string;
    authorId: string;
    authorName: string;
    content: string;
    attachments?: { id: string; filename: string; content_type: string; size: number; url: string }[];
    /** The replied-to message is a forward: Discord gives its text and files in its snapshot. */
    forwarded?: boolean;
  };
}

/** One MESSAGE_CREATE that mentions OpenBot, through Signal and the relay. Returns Signal's delivery. */
async function mention(message: Mention) {
  const actions = signal.handle(
    gateway("MESSAGE_CREATE", {
      id: message.id,
      channel_id: message.channelId,
      guild_id: message.guildId,
      content: `<@${APP}> ${message.content}`,
      timestamp: "2026-10-19T11:47:00.000Z",
      author: { id: message.authorId, username: message.authorName },
      ...(message.roles ? { member: { nick: null, roles: message.roles } } : {}),
      mentions: [{ id: APP }],
      attachments: [],
      ...(message.replyTo
        ? {
            message_reference: { type: 0, message_id: message.replyTo.id },
            referenced_message: {
              id: message.replyTo.id,
              timestamp: "2026-10-19T11:40:00.000Z",
              author: { id: message.replyTo.authorId, username: message.replyTo.authorName },
              ...(message.replyTo.forwarded
                ? {
                    content: "",
                    attachments: [],
                    message_reference: { type: 1, message_id: nextId() },
                    message_snapshots: [
                      {
                        message: { content: message.replyTo.content, attachments: message.replyTo.attachments ?? [] },
                      },
                    ],
                  }
                : { content: message.replyTo.content, attachments: message.replyTo.attachments ?? [] }),
            },
          }
        : {}),
    }),
  );
  const action = actions[0];
  assert.ok(action?.type === "deliver", "Signal did not pass the mention on.");
  const delivery = decodeDiscordDelivery(JSON.parse(JSON.stringify(action.delivery)));
  const handler = relayHandler;
  assert.ok(handler, "The messaging service has no relay handler.");
  const answer = await runCauseEffect(handler(action.guildId, { platform: "discord", delivery }));
  assert.equal(answer.status, 200);
  return delivery;
}

/** The service reacts 👀 to a message it queued, and something else to a message it refused. */
const received = (messageId: string) =>
  waitForCall(
    (call) =>
      call.method === "PUT" && call.route.includes(`/messages/${messageId}/reactions/${encodeURIComponent("👀")}/`),
  );

/** Whether OpenBot reacted to the message, or posted a reply to it. */
function touched(messageId: string): boolean {
  return calls.some(
    (call) => call.route.includes(`/messages/${messageId}`) || JSON.stringify(call.body ?? null).includes(messageId),
  );
}

async function promptOf(services: Booted, guildId: string, mentionId: string, channelId: string): Promise<string> {
  const record = services.threads.store.connectionForWorkspace("discord", guildId);
  assert.ok(record);
  const context = services.mailbox.deliveryForKey(`messaging:${record.connectionId}:${channelId}:${mentionId}`);
  assert.ok(context, "The mention has no delivery.");
  const prepared = await runCauseEffect(services.threads.prepare(context));
  assert.ok(prepared, "The delivery has no prompt.");
  return prepared.text;
}

let messageId = 700000000000000000n;
const nextId = () => {
  messageId += 1n;
  return messageId.toString();
};

try {
  await step("the intents ask for Message Content only with the flag", async () => {
    assert.equal(DISCORD_GATEWAY_INTENTS & DISCORD_MESSAGE_CONTENT_INTENT, 0);
    assert.equal(DISCORD_MESSAGE_CONTENT_INTENT, 1 << 15);
    return { base: DISCORD_GATEWAY_INTENTS, messageContent: DISCORD_MESSAGE_CONTENT_INTENT };
  });

  // Two Discord servers connect to one OpenBot server, as after two installs.
  await boot(async ({ threads }) => {
    for (const [guildId, name] of [
      [GUILD_ONE, "Nightly"],
      [GUILD_TWO, "Labs"],
    ] as const) {
      const record = threads.store.ensureConnection("discord", guildId, name);
      threads.store.updateConnection(record.connectionId, { enabled: true });
      await runCauseEffect(credentials.set(record.connectionId, { guildId, guildName: name, appId: APP }));
    }
  });

  await boot(async (services) => {
    const { messaging } = services;

    await step("two Discord servers connect, and one Discord Orchestrator answers both", async () => {
      const overview = messaging.discordOverview().connections;
      assert.equal(overview.length, 2);
      assert.ok(overview.every((connection) => connection.state === "connected"));
      const one = await runCauseEffect(messaging.addOrchestrator("discord", { workspaceId: GUILD_ONE }));
      // The new orchestrator goes to every Discord server that has none.
      assert.ok(
        messaging.discordOverview().connections.every((connection) => connection.orchestratorAgentId === one.agentId),
        "The second Discord server did not get the orchestrator.",
      );
      const two = await runCauseEffect(messaging.addOrchestrator("discord", { workspaceId: GUILD_TWO }));
      assert.equal(two.agentId, one.agentId, "A second Discord Orchestrator was made.");
      assert.equal(two.sectionId, null);
      return { connections: overview.map((connection) => connection.workspaceId), orchestrators: 1 };
    });

    await step("with no role list, anyone's mention is queued", async () => {
      const id = nextId();
      await mention({
        id,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: BOB,
        authorName: "Bob",
        roles: [],
        content: "hello",
      });
      await received(id);
      return { messageId: id };
    });

    await step("Signal lists the roles a person can have, highest first", async () => {
      const list = await runCauseEffect(messaging.listDiscordRoles(GUILD_ONE));
      assert.deepEqual(list.roles, [
        { id: MAINTAINERS, name: "Maintainers" },
        { id: MEMBERS, name: "Members" },
        // Cut to the 100 UTF-16 units that IPC and the Team API allow, on a whole emoji.
        { id: LONG_ROLE, name: "🦊".repeat(50) },
      ]);
      assert.ok(isDiscordRoleList(list), "The role list does not pass the IPC decoder.");
      return { roles: list.roles.length };
    });

    await step("an older Signal: the role list gives the unsupported text", async () => {
      const failure = await runCauseEffect(messaging.listDiscordRoles(GUILD_TWO)).then(
        () => null,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      assert.equal(failure, "OpenBot cannot list Discord roles yet. Try again later.");
      return { failure };
    });

    await step("the IPC decoder refuses a role list with a repeated role", async () => {
      assert.throws(() =>
        parseSetDiscordAccessInput({
          workspaceId: GUILD_ONE,
          allowedRoles: [
            { id: MAINTAINERS, name: "Maintainers" },
            { id: MAINTAINERS, name: "Maintainers" },
          ],
        }),
      );
      assert.deepEqual((await runCauseEffect(messaging.discordAccess(GUILD_ONE))).allowedRoles, []);
      return { refused: true };
    });

    await step("with a role list, only members with one of its roles reach OpenBot", async () => {
      const input = parseSetDiscordAccessInput({
        workspaceId: GUILD_ONE,
        allowedRoles: [{ id: MAINTAINERS, name: "Maintainers" }],
      });
      const saved = await runCauseEffect(messaging.setDiscordAccess(input));
      assert.deepEqual(saved.allowedRoles, [{ id: MAINTAINERS, name: "Maintainers" }]);

      const outsider = nextId();
      await mention({
        id: outsider,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: BOB,
        authorName: "Bob",
        roles: [MEMBERS],
        content: "do it",
      });
      const unknownRoles = nextId();
      // A mention from an older Signal has no roles.
      await mention({
        id: unknownRoles,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: BOB,
        authorName: "Bob",
        content: "do it",
      });
      const maintainer = nextId();
      await mention({
        id: maintainer,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: ANA,
        authorName: "Ana",
        roles: [MEMBERS, MAINTAINERS],
        content: "do it",
      });
      await received(maintainer);
      // The role check runs before the first await, so the ignored mentions are decided by now.
      assert.equal(touched(outsider), false, "OpenBot reacted or replied to a member without a listed role.");
      assert.equal(touched(unknownRoles), false, "OpenBot reacted or replied to a mention without roles.");
      const record = services.threads.store.connectionForWorkspace("discord", GUILD_ONE);
      assert.ok(record);
      assert.equal(
        services.mailbox.deliveryForKey(`messaging:${record.connectionId}:${CHANNEL_ONE}:${outsider}`),
        null,
      );
      assert.equal(
        services.mailbox.deliveryForKey(`messaging:${record.connectionId}:${CHANNEL_ONE}:${unknownRoles}`),
        null,
      );

      // The other Discord server has no list.
      const other = nextId();
      await mention({
        id: other,
        guildId: GUILD_TWO,
        channelId: CHANNEL_TWO,
        authorId: BOB,
        authorName: "Bob",
        roles: [],
        content: "hi",
      });
      await received(other);
      return { ignored: [outsider, unknownRoles], queued: [maintainer, other] };
    });

    await step("a reply to a person's message gives that message as context", async () => {
      const replied = nextId();
      const id = nextId();
      await mention({
        id,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: EVA,
        authorName: "Eva",
        roles: [MAINTAINERS],
        content: "make an issue for this",
        replyTo: {
          id: replied,
          authorId: KAMIL,
          authorName: "Kamil",
          content: `Feature idea: webhooks for OpenBot. <@${BOB}> agrees.`,
        },
      });
      await received(id);
      const prompt = await promptOf(services, GUILD_ONE, id, CHANNEL_ONE);
      assert.match(
        prompt,
        /--- the message this one replies to \(context\) ---\n\[2026-10-19T11:40:00\.000Z\] Kamil: Feature idea: webhooks for OpenBot\. @Bob agrees\.\n--- message ---\nmake an issue for this/u,
      );
      assert.doesNotMatch(prompt, /earlier messages/u);

      const plain = nextId();
      await mention({
        id: plain,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: OLA,
        authorName: "Ola",
        roles: [MAINTAINERS],
        content: "status?",
      });
      await received(plain);
      assert.doesNotMatch(await promptOf(services, GUILD_ONE, plain, CHANNEL_ONE), /replies to/u);
      return { replyContext: true };
    });

    await step("a reply to a person's image gives the image to the agent", async () => {
      const replied = nextId();
      const id = nextId();
      const url = `https://cdn.discordapp.com/attachments/${CHANNEL_ONE}/${replied}/screenshot.png`;
      const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      // The driver downloads the file from Discord's CDN: this answers only that address.
      const realFetch = globalThis.fetch;
      globalThis.fetch = Object.assign(
        (input: string | URL | Request, init?: RequestInit) =>
          String(input) === url
            ? Promise.resolve(new Response(image, { headers: { "content-type": "image/png" } }))
            : realFetch(input, init),
        realFetch,
      );
      try {
        // The replied-to message has only the image, no text.
        const delivery = await mention({
          id,
          guildId: GUILD_ONE,
          channelId: CHANNEL_ONE,
          authorId: KAMIL,
          authorName: "Kamil",
          roles: [MAINTAINERS],
          content: "make an issue for this",
          replyTo: {
            id: replied,
            authorId: ANA,
            authorName: "Ana",
            content: "",
            attachments: [
              { id: nextId(), filename: "screenshot.png", content_type: "image/png", size: image.byteLength, url },
            ],
          },
        });
        assert.ok(delivery.kind === "message");
        assert.deepEqual(
          delivery.message.replyTo?.quote?.attachments.map((file) => file.url),
          [url],
          "Signal did not pass on the replied-to image.",
        );
        await received(id);
        const record = services.threads.store.connectionForWorkspace("discord", GUILD_ONE);
        assert.ok(record);
        const context = services.mailbox.deliveryForKey(`messaging:${record.connectionId}:${CHANNEL_ONE}:${id}`);
        assert.deepEqual(
          context?.managedAttachments.map((file) => file.name),
          ["screenshot.png"],
          "The agent's message has no replied-to image.",
        );
        const prompt = await promptOf(services, GUILD_ONE, id, CHANNEL_ONE);
        assert.match(
          prompt,
          /the message this one replies to \(context\) ---\n\[[^\]]+\] Ana: \(Attached files: screenshot\.png\)\n/u,
        );
        assert.doesNotMatch(prompt, /did not arrive/u);
        return { repliedImage: true };
      } finally {
        globalThis.fetch = realFetch;
      }
    });

    await step("an image posted without a mention before a new conversation gives the image to the agent", async () => {
      const posted = nextId();
      const id = nextId();
      const url = `https://cdn.discordapp.com/attachments/${CHANNEL_ONE}/${posted}/crash.png`;
      const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const realFetch = globalThis.fetch;
      globalThis.fetch = Object.assign(
        (input: string | URL | Request, init?: RequestInit) =>
          String(input) === url
            ? Promise.resolve(new Response(image, { headers: { "content-type": "image/png" } }))
            : realFetch(input, init),
        realFetch,
      );
      // tomek posts only an image and does not mention OpenBot, so Signal does not pass it on.
      channelOne.push({
        id: posted,
        content: "",
        timestamp: "2026-10-19T11:46:00.000Z",
        author: { id: TOMEK, username: "tomek" },
        attachments: [{ id: nextId(), filename: "crash.png", content_type: "image/png", size: image.byteLength, url }],
      });
      try {
        // Olek then asks for an issue in a new message, not a reply.
        await mention({
          id,
          guildId: GUILD_ONE,
          channelId: CHANNEL_ONE,
          authorId: OLEK,
          authorName: "Olek",
          roles: [MAINTAINERS],
          content: "zrob issue",
        });
        await received(id);
        const record = services.threads.store.connectionForWorkspace("discord", GUILD_ONE);
        assert.ok(record);
        const context = services.mailbox.deliveryForKey(`messaging:${record.connectionId}:${CHANNEL_ONE}:${id}`);
        assert.deepEqual(
          context?.managedAttachments.map((file) => file.name),
          ["crash.png"],
          "The agent's message has no earlier image.",
        );
        const prompt = await promptOf(services, GUILD_ONE, id, CHANNEL_ONE);
        assert.match(
          prompt,
          /--- earlier messages \(context, oldest first\) ---\n\[2026-10-19T11:46:00\.000Z\] tomek: \(Attached files: crash\.png\)\n/u,
        );
        assert.match(
          prompt,
          /--- message ---\nzrob issue\n\n\(Files of earlier messages, given with this one: tomek: crash\.png\)/u,
        );
        assert.doesNotMatch(prompt, /did not arrive/u);
        // An older Signal gives earlier messages without files.
        assert.deepEqual(
          decodeDiscordHistory({
            messages: [
              {
                id: posted,
                authorId: TOMEK,
                authorName: "tomek",
                authorIsBot: false,
                content: "",
                replyToId: null,
                sentAt: "2026-10-19T11:46:00.000Z",
              },
            ],
          })[0]?.attachments,
          [],
        );
        return { earlierImage: true };
      } finally {
        globalThis.fetch = realFetch;
        channelOne.length = 0;
      }
    });

    await step("a forwarded report gives its text and image to the agent, or says that Discord gave none", async () => {
      const replied = nextId();
      const id = nextId();
      const url = `https://cdn.discordapp.com/attachments/${CHANNEL_ONE}/${replied}/report.png`;
      const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const realFetch = globalThis.fetch;
      globalThis.fetch = Object.assign(
        (input: string | URL | Request, init?: RequestInit) =>
          String(input) === url
            ? Promise.resolve(new Response(image, { headers: { "content-type": "image/png" } }))
            : realFetch(input, init),
        realFetch,
      );
      try {
        // Nina replies to a forward of a report that has a screenshot.
        await mention({
          id,
          guildId: GUILD_ONE,
          channelId: CHANNEL_ONE,
          authorId: NINA,
          authorName: "Nina",
          roles: [MAINTAINERS],
          content: "ini",
          replyTo: {
            id: replied,
            authorId: ANA,
            authorName: "Ana",
            content: "Login fails after the update.",
            attachments: [
              { id: nextId(), filename: "report.png", content_type: "image/png", size: image.byteLength, url },
            ],
            forwarded: true,
          },
        });
        await received(id);
        const record = services.threads.store.connectionForWorkspace("discord", GUILD_ONE);
        assert.ok(record);
        const context = services.mailbox.deliveryForKey(`messaging:${record.connectionId}:${CHANNEL_ONE}:${id}`);
        assert.deepEqual(
          context?.managedAttachments.map((file) => file.name),
          ["report.png"],
          "The agent's message has no forwarded image.",
        );
        assert.match(
          await promptOf(services, GUILD_ONE, id, CHANNEL_ONE),
          /the message this one replies to \(context\) ---\n\[[^\]]+\] Ana: \(Forwarded message\)\nLogin fails after the update\.\n\(Attached files: report\.png\)\n/u,
        );
      } finally {
        globalThis.fetch = realFetch;
      }

      // Without the Message Content intent, Discord gives a forward with an empty snapshot.
      const empty = nextId();
      await mention({
        id: empty,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: PIOTR,
        authorName: "Piotr",
        roles: [MAINTAINERS],
        content: "ini",
        replyTo: { id: nextId(), authorId: ANA, authorName: "Ana", content: "", forwarded: true },
      });
      await received(empty);
      assert.match(
        await promptOf(services, GUILD_ONE, empty, CHANNEL_ONE),
        /\] Ana: \(Forwarded message: Discord did not give its text or files\)\n/u,
      );

      // A forward posted without a mention, before a new conversation, is context too.
      const posted = nextId();
      channelOne.push({
        id: posted,
        content: "",
        timestamp: "2026-10-19T11:46:00.000Z",
        author: { id: TOMEK, username: "tomek" },
        attachments: [],
        message_reference: { type: 1, message_id: nextId() },
        message_snapshots: [{ message: { content: "Report: the export button does nothing.", attachments: [] } }],
      });
      try {
        const asked = nextId();
        await mention({
          id: asked,
          guildId: GUILD_ONE,
          channelId: CHANNEL_ONE,
          authorId: RITA,
          authorName: "Rita",
          roles: [MAINTAINERS],
          content: "sesuai report diatas",
        });
        await received(asked);
        assert.match(
          await promptOf(services, GUILD_ONE, asked, CHANNEL_ONE),
          /--- earlier messages \(context, oldest first\) ---\n\[2026-10-19T11:46:00\.000Z\] tomek: \(Forwarded message\)\nReport: the export button does nothing\.\n/u,
        );
      } finally {
        channelOne.length = 0;
      }
      return { forwardedReport: true };
    });
  });

  await boot(async (services) => {
    await step("after a restart, the role list stays; an empty list lets everyone again", async () => {
      const access = await runCauseEffect(services.messaging.discordAccess(GUILD_ONE));
      assert.deepEqual(access.allowedRoles, [{ id: MAINTAINERS, name: "Maintainers" }]);
      assert.deepEqual((await runCauseEffect(services.messaging.discordAccess(GUILD_TWO))).allowedRoles, []);
      const outsider = nextId();
      await mention({
        id: outsider,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: BOB,
        authorName: "Bob",
        roles: [MEMBERS],
        content: "again",
      });
      const maintainer = nextId();
      await mention({
        id: maintainer,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: IGA,
        authorName: "Iga",
        roles: [MAINTAINERS],
        content: "again",
      });
      await received(maintainer);
      assert.equal(touched(outsider), false);

      // An empty list lets everyone again.
      await runCauseEffect(services.messaging.setDiscordAccess({ workspaceId: GUILD_ONE, allowedRoles: [] }));
      const everyone = nextId();
      await mention({
        id: everyone,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: ULA,
        authorName: "Ula",
        roles: [],
        content: "now?",
      });
      await received(everyone);
      return { allowedRoles: access.allowedRoles };
    });
  });

  report.passed = true;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
// The report names steps and ids only: no message text.
assert.ok(!readFileSync(REPORT, "utf8").includes("webhooks for OpenBot"), "The report contains message text.");
process.stdout.write(`Discord access check passed. Report: ${REPORT}\n`);
