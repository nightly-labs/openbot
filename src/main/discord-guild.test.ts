// @vitest-environment node

// End to end on the host half of the OpenBot Discord app: the real `SignalIngress` socket, the
// messaging core with its Discord driver, and `AgentService` with its SQLite database. Signal is a
// local fake that speaks the `ingress` frames and answers the Discord calls at `DISCORD_API_PATH`, as
// the real Signal does with the bot token. Signal's own Gateway and call checks are tested in
// `remote/api/test`, and the Worker's install in `apps/auth-api/test/discord-app.test.ts`. Only the
// provider is faked, as in every agent service test. Writes
// .openbot-build/discord-guild-e2e/report.json.

import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { sealDiscordGuildGrant } from "@openbot/contracts/discord-guild-grant";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { DiscordDelivery, DiscordInboundMessage } from "@openbot/contracts/signal-protocol/discord-api";
import { DISCORD_API_PATH } from "@openbot/contracts/signal-protocol/discord-route";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import type { AgentService } from "../backend/agent-service";
import {
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  waitFor,
} from "../backend/agent-service-test-harness";
import { runCauseEffect } from "../backend/effect-boundary";
import { DiscordConnectFailed } from "../backend/messaging/discord/discord-connect";
import { discordDriver } from "../backend/messaging/discord/discord-driver";
import { type MessagingCredentials, MessagingService } from "../backend/messaging/messaging-service";
import { SignalIngress } from "./signal-ingress";

const REPORT_DIR = resolve(import.meta.dirname, "../../.openbot-build/discord-guild-e2e");
const GUILD_ID = "111";
const CHANNEL_ID = "222";
const APP_ID = "333";

/**
 * Signal for the Discord app: the `ingress` socket, which gives the host a session and passes the
 * guild's events on, and the Discord calls of that session.
 */
class FakeSignal {
  readonly hellos: DynamicRecord[] = [];
  readonly calls: DynamicRecord[] = [];
  /** The guilds that the session says are routed to the host. */
  routed = [GUILD_ID];
  /** Answers the next call of this operation with a Discord rate limit, as Signal does. */
  rateLimitNext: string | null = null;
  rateLimited = 0;
  #server: Server | null = null;
  #sockets: WebSocketServer | null = null;
  #socket: WebSocket | null = null;
  #session = "";
  #sessions = 0;
  #messageId = 5000;
  url = "";

  async start(): Promise<void> {
    this.#server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const reply = (status: number, value: DynamicRecord) => {
        response.statusCode = status;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(value));
      };
      if (request.url !== DISCORD_API_PATH || request.headers.authorization !== `Bearer ${this.#session}`)
        return reply(401, { error: { code: "unauthorized" } });
      const call = JSON.parse(Buffer.concat(chunks).toString());
      if (!isDynamicRecord(call) || call.guildId !== GUILD_ID) return reply(403, { error: { code: "unknown_guild" } });
      if (call.op === this.rateLimitNext) {
        this.rateLimitNext = null;
        this.rateLimited += 1;
        return reply(429, { error: { code: "rate_limited", retryAfterMs: 20 } });
      }
      this.calls.push(call);
      switch (call.op) {
        case "createMessage":
          this.#messageId += 1;
          return reply(200, { messageId: String(this.#messageId) });
        case "listMessages":
          return reply(200, { messages: [] });
        case "member":
          return reply(200, { name: "Alice" });
        case "channel":
          return reply(200, { name: "general" });
        default:
          return reply(200, {});
      }
    });
    this.#sockets = new WebSocketServer({ server: this.#server });
    this.#sockets.on("connection", (socket) => {
      socket.on("message", (data) => {
        const frame = JSON.parse(data.toString());
        if (!isDynamicRecord(frame) || frame.type !== "hello") return;
        this.hellos.push(frame);
        this.#socket = socket;
        this.#session = `session-${++this.#sessions}`;
        socket.send(
          JSON.stringify({ type: "ready", version: 1, connectionId: null, resumeToken: "r", iceServers: [] }),
        );
        socket.send(JSON.stringify({ type: "discord-session", version: 1, token: this.#session, guilds: this.routed }));
      });
    });
    await new Promise<void>((resolve) => this.#server?.listen(0, "127.0.0.1", resolve));
    const address = this.#server.address();
    if (!address || typeof address === "string") throw new Error("The fake Signal has no port.");
    this.url = `ws://127.0.0.1:${address.port}/v1/signal`;
  }

  async stop(): Promise<void> {
    for (const client of this.#sockets?.clients ?? []) client.terminate();
    await new Promise<void>((resolve) => this.#sockets?.close(() => resolve()));
    this.#server?.closeAllConnections();
    await new Promise<void>((resolve) => this.#server?.close(() => resolve()));
  }

  /** One Gateway event of a guild, as Signal passes it to the host. Nothing is answered. */
  deliver(guildId: string, delivery: DiscordDelivery): void {
    const socket = this.#socket;
    if (!socket) throw new Error("The host has no ingress socket.");
    socket.send(JSON.stringify({ type: "discord-delivery", version: 1, guildId, delivery }));
  }

  of(op: string): DynamicRecord[] {
    return this.calls.filter((call) => call.op === op);
  }
}

class MemoryCredentials implements MessagingCredentials {
  readonly values = new Map<string, Record<string, string>>();
  keys() {
    return [...this.values.keys()];
  }
  status(key: string) {
    return this.values.has(key) ? ("saved" as const) : ("missing" as const);
  }
  get(key: string) {
    return this.values.get(key) ?? null;
  }
  set(key: string, values: Record<string, string>) {
    return Effect.sync(() => {
      this.values.set(key, values);
    });
  }
  clear(key: string) {
    return Effect.sync(() => {
      this.values.delete(key);
    });
  }
  retain(keys: ReadonlySet<string>) {
    return Effect.sync(() => {
      for (const key of [...this.values.keys()]) if (!keys.has(key)) this.values.delete(key);
    });
  }
}

function mention(id: string, replyTo: DiscordInboundMessage["replyTo"] = null): DiscordDelivery {
  return {
    kind: "message",
    message: {
      id,
      channelId: CHANNEL_ID,
      authorId: "444",
      authorName: "Alice",
      content: "hello",
      replyTo,
      attachments: [],
      sentAt: "2026-10-06T10:00:00.000Z",
    },
  };
}

let root = "";
let service: AgentService | null = null;
let messaging: MessagingService | null = null;
let ingress: SignalIngress | null = null;
let signal: FakeSignal;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
  signal = new FakeSignal();
  await signal.start();
});

afterEach(async () => {
  if (messaging) await runCauseEffect(messaging.stop());
  messaging = null;
  if (ingress) await Effect.runPromise(ingress.dispose());
  ingress = null;
  await signal.stop();
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("OpenBot Discord app end to end", () => {
  it("connects a guild, answers its mentions in a reply chain through Signal, and disconnects it", async () => {
    const started = await startService(root, { provider: "codex", autoComplete: true });
    service = started.service;
    await runCauseEffect(started.store.getOrCreate("discord-agent"));
    const credentials = new MemoryCredentials();
    const authorizations: Array<{ hostNonce: string; hostPublicKey: string }> = [];
    const unlinked: string[] = [];
    let failUnlink = false;
    let routeTickets = 0;
    ingress = new SignalIngress({
      hostId: () => "host-1",
      signedIn: () => true,
      issueTicket: () => Effect.succeed({ ticket: "ticket-1", signalUrl: signal.url }),
      issueSlackRoute: () => Effect.die(new Error("No Slack in this test.")),
      issueDiscordRoute: () => Effect.sync(() => `discord-route-${++routeTickets}`),
    });
    messaging = new MessagingService({
      threads: started.service.messaging,
      agents: {
        listAgents: () => started.service.listAgents(),
        respondToApproval: (input) => started.service.respondToApproval(input),
        onEvent: (listener) => {
          started.service.on("event", listener);
          return () => started.service.off("event", listener);
        },
        createAgentProfile: (input) => started.service.createAgentProfile(input),
        createMemory: (input) => started.service.createMemory(input),
      },
      credentials,
      drivers: [discordDriver({ ingress })],
      downloadsRoot: join(root, "messaging-downloads"),
      ingress,
      discordApp: {
        authorize: (input) =>
          Effect.sync(() => {
            authorizations.push(input);
            return "https://discord.com/oauth2/authorize?client_id=333";
          }),
        unlink: (guildId) =>
          failUnlink
            ? Effect.fail(new DiscordConnectFailed({ cause: new Error("The account service is unreachable.") }))
            : Effect.sync(() => {
                unlinked.push(guildId);
              }),
        openExternal: async () => undefined,
      },
    });
    await runCauseEffect(messaging.start());

    // The install: the guild link comes back sealed to this connect's key, and only this run opens it.
    const connect = async () => {
      if (!messaging) throw new Error("Messaging service is missing.");
      await runCauseEffect(messaging.connectDiscordGuild());
      const authorization = authorizations.at(-1);
      if (!authorization) throw new Error("The connect did not start.");
      const grant = await sealDiscordGuildGrant(authorization.hostPublicKey, authorization.hostNonce, {
        guildId: GUILD_ID,
        guildName: "Test server",
        appId: APP_ID,
      });
      expect(await runCauseEffect(messaging.completeDiscordGuild("another-nonce", grant))).toBe(false);
      expect(await runCauseEffect(messaging.completeDiscordGuild(authorization.hostNonce, grant))).toBe(true);
    };
    await connect();
    const connection = () => messaging?.discordOverview().connections[0];
    const { agentId: orchestratorId } = await runCauseEffect(
      messaging.addOrchestrator("discord", { workspaceId: GUILD_ID }),
    );
    await waitFor(() => connection()?.state === "connected");
    expect(connection()).toMatchObject({ workspaceId: GUILD_ID, workspaceName: "Test server", credentials: "saved" });
    expect(messaging.slackOverview().connections).toEqual([]);
    // The socket asked only for the Discord route, and told Signal the new guild after the connect.
    await waitFor(() => signal.hellos.some((hello) => isString(hello.discordRoute) && routeTickets >= 2));
    expect(signal.hellos.every((hello) => hello.peer === "ingress" && hello.slackRoute === undefined)).toBe(true);

    // A mention runs the agent once, however often Signal passes it on. OpenBot replies to it.
    // The status post is rate limited once: it waits, and arrives.
    signal.rateLimitNext = "createMessage";
    signal.deliver(GUILD_ID, mention("1000"));
    signal.deliver(GUILD_ID, mention("1000"));
    await waitFor(() => signal.of("editMessage").length > 0);
    const turns = () => started.client.requests.filter((request) => request.method === "turn/start");
    expect(turns()).toHaveLength(1);
    const status = signal.of("createMessage")[0];
    expect(status).toMatchObject({ channelId: CHANNEL_ID, replyTo: "1000" });
    expect(signal.rateLimited).toBe(1);
    const statusId = "5001";
    await waitFor(() => signal.of("react").some((call) => call.emoji === "✅" && call.on === true));
    expect(signal.of("react").find((call) => call.emoji === "👀")).toMatchObject({ messageId: "1000", on: true });
    const [link] = started.service.messaging.store.links(orchestratorId);
    if (!link) throw new Error("The mention has no conversation.");
    expect(link.threadKey).toBe("1000");

    // A reply to an OpenBot post continues the same conversation, which OpenBot still replies to.
    signal.deliver(GUILD_ID, mention("1001", { messageId: statusId, authorIsBot: true, rootId: "1000" }));
    await waitFor(() => turns().length === 2);
    await waitFor(() => signal.of("createMessage").filter((call) => call.replyTo === "1000").length >= 2);
    expect(started.service.messaging.store.links(orchestratorId).map((item) => item.linkId)).toEqual([link.linkId]);
    // A mention that replies to someone else starts its own conversation.
    signal.deliver(GUILD_ID, mention("1002", { messageId: "1000", authorIsBot: false, rootId: null }));
    await waitFor(() => started.service.messaging.store.links(orchestratorId).length === 2);
    await waitFor(() => turns().length === 3);

    // An event of a guild that this host does not have does nothing.
    signal.deliver("999", mention("1003"));

    // OpenBot was removed from the guild: the connection stops, and Signal stops routing it here.
    signal.deliver(GUILD_ID, { kind: "removed" });
    await waitFor(() => connection()?.state === "invalid_token");
    expect(unlinked).toEqual([GUILD_ID]);
    expect(turns()).toHaveLength(3);
    // Reconnect cannot bring a removed bot back: it starts the install again.
    const installs = authorizations.length;
    await runCauseEffect(messaging.reconnect("discord", GUILD_ID));
    expect(authorizations).toHaveLength(installs + 1);
    expect(connection()?.state).toBe("invalid_token");

    // Connected again, the guild keeps its conversations and its agent.
    await connect();
    await waitFor(() => connection()?.state === "connected");
    expect(started.service.messaging.store.links(orchestratorId)).toHaveLength(2);
    expect(connection()?.orchestratorAgentId).toBe(orchestratorId);

    // The guild was unlinked while this computer was off: the next session does not name it.
    signal.routed = [];
    ingress.reconnect();
    await waitFor(() => connection()?.state === "invalid_token");
    expect(unlinked).toEqual([GUILD_ID, GUILD_ID]);
    signal.routed = [GUILD_ID];

    // A disconnect that cannot unlink changes nothing, so it can be tried again.
    failUnlink = true;
    await expect(runCauseEffect(messaging.disconnectDiscordGuild(GUILD_ID))).rejects.toThrow();
    expect(connection()).toMatchObject({ workspaceId: GUILD_ID, credentials: "saved" });
    failUnlink = false;

    // Disconnect forgets the guild and unlinks it.
    await runCauseEffect(messaging.disconnectDiscordGuild(GUILD_ID));
    expect(credentials.values.size).toBe(0);
    expect(unlinked).toEqual([GUILD_ID, GUILD_ID, GUILD_ID]);
    expect(messaging.discordOverview().connections).toEqual([]);

    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(
      join(REPORT_DIR, "report.json"),
      `${JSON.stringify(
        {
          connected: true,
          routeTickets,
          turns: turns().length,
          rateLimitedCallsRetried: signal.rateLimited,
          replyChainKept: true,
          removedUnlinked: true,
          conversationKept: true,
          calls: signal.calls.length,
        },
        null,
        2,
      )}\n`,
    );
  });
});
