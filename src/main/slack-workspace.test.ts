// @vitest-environment node

// End to end on the host half of the OpenBot Slack app: the real `SlackIngress` socket, the messaging
// core with its Events API transport, and `AgentService` with its SQLite database. Signal and Slack
// are local fakes: Signal is a WebSocket server that speaks the `ingress` frames, and Slack is one
// HTTP server. Signal's own route, with the signature check, is tested in
// `remote/api/test/app.test.ts`, and the Worker's install in `apps/auth-api/test/slack-app.test.ts`.
// Only the provider is faked, as in every agent service test. Writes
// .openbot-build/slack-workspace-e2e/report.json.

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { SLACK_BOT_SCOPES } from "@openbot/contracts/slack-app";
import { sealSlackWorkspaceGrant } from "@openbot/contracts/slack-workspace-grant";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import type { AgentService } from "../backend/agent-service";
import {
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  waitFor,
} from "../backend/agent-service-test-harness";
import { type MessagingCredentials, MessagingService } from "../backend/messaging/messaging-service";
import { slackDriver } from "../backend/messaging/slack/slack-driver";
import { SlackIngress } from "./slack-ingress";

const REPORT_DIR = resolve(import.meta.dirname, "../../.openbot-build/slack-workspace-e2e");
const BOT_TOKEN = "xoxb-9999-8888-openbotbottoken";

interface Answer {
  status: number;
  contentType?: string;
  body?: string;
}

/** Signal's side of the `ingress` socket: it takes the host's hello and passes a workspace's requests on. */
class FakeSignal {
  readonly hellos: DynamicRecord[] = [];
  #server: WebSocketServer | null = null;
  #socket: WebSocket | null = null;
  readonly #answers = new Map<string, (answer: Answer) => void>();
  url = "";

  async start(): Promise<void> {
    this.#server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    this.#server.on("connection", (socket) => {
      socket.on("message", (data) => {
        const frame = JSON.parse(data.toString());
        if (!isDynamicRecord(frame)) return;
        if (frame.type === "hello") {
          this.hellos.push(frame);
          this.#socket = socket;
          socket.send(
            JSON.stringify({ type: "ready", version: 1, connectionId: null, resumeToken: "r", iceServers: [] }),
          );
        } else if (frame.type === "slack-delivery-result" && isString(frame.requestId)) {
          this.#answers.get(frame.requestId)?.({
            status: Number(frame.status),
            ...(isString(frame.contentType) ? { contentType: frame.contentType } : {}),
            ...(isString(frame.body) ? { body: frame.body } : {}),
          });
        }
      });
    });
    await new Promise<void>((resolve) => this.#server?.once("listening", resolve));
    const address = this.#server.address();
    if (!address || typeof address === "string") throw new Error("The fake Signal has no port.");
    this.url = `ws://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    for (const client of this.#server?.clients ?? []) client.terminate();
    await new Promise<void>((resolve) => this.#server?.close(() => resolve()));
  }

  /** One Slack request that Signal checked, as it passes it to the host, and the host's answer. */
  deliver(teamId: string, payload: DynamicRecord): Promise<Answer> {
    const socket = this.#socket;
    if (!socket) throw new Error("The host has no ingress socket.");
    const requestId = randomUUID().replaceAll("-", "");
    return new Promise((resolve) => {
      this.#answers.set(requestId, resolve);
      socket.send(
        JSON.stringify({
          type: "slack-delivery",
          version: 1,
          requestId,
          teamId,
          kind: "events",
          retryNum: null,
          retryReason: null,
          bodyBase64: Buffer.from(
            JSON.stringify({ type: "event_callback", team_id: teamId, api_app_id: "A1", ...payload }),
          ).toString("base64"),
        }),
      );
    });
  }
}

/** Slack's Web API for the bot of the OpenBot app in one workspace. */
class FakeSlack {
  readonly calls: Array<{ method: string; token: string | undefined }> = [];
  #server: Server | null = null;
  #ts = 1000;
  origin = "";

  async start(): Promise<void> {
    this.#server = createServer(async (request, response) => {
      for await (const _chunk of request) {
        // The parameters do not matter here.
      }
      const method = (request.url ?? "").replace("/api/", "");
      const token = request.headers.authorization?.replace("Bearer ", "");
      this.calls.push({ method, token });
      const reply = (value: DynamicRecord, headers: Record<string, string> = {}) => {
        for (const [name, header] of Object.entries(headers)) response.setHeader(name, header);
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true, ...value }));
      };
      if (token !== BOT_TOKEN) return response.end(JSON.stringify({ ok: false, error: "invalid_auth" }));
      switch (method) {
        case "auth.test":
          return reply(
            { team_id: "T1", team: "Test workspace", user_id: "UBOT", bot_id: "B1" },
            { "x-oauth-scopes": SLACK_BOT_SCOPES.join(",") },
          );
        case "bots.info":
          return reply({ bot: { app_id: "A1" } });
        case "users.info":
          return reply({ user: { name: "alice", profile: { display_name: "Alice" } } });
        case "conversations.info":
          return reply({ channel: { name: "general" } });
        case "conversations.replies":
          return reply({ messages: [] });
        case "chat.postMessage":
          this.#ts += 1;
          return reply({ ts: `${this.#ts}.000` });
        default:
          return reply({});
      }
    });
    await new Promise<void>((resolve) => this.#server?.listen(0, "127.0.0.1", resolve));
    const address = this.#server.address();
    if (!address || typeof address === "string") throw new Error("The fake Slack has no port.");
    this.origin = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.#server?.close(() => resolve()));
  }

  of(method: string) {
    return this.calls.filter((call) => call.method === method);
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
  async set(key: string, values: Record<string, string>) {
    this.values.set(key, values);
  }
  async clear(key: string) {
    this.values.delete(key);
  }
  async retain(keys: ReadonlySet<string>) {
    for (const key of [...this.values.keys()]) if (!keys.has(key)) this.values.delete(key);
  }
}

function mention(eventId: string, ts: string): DynamicRecord {
  return {
    event_id: eventId,
    event: { type: "app_mention", user: "UALICE", text: "<@UBOT> hello", ts, channel: "C1" },
  };
}

let root = "";
let service: AgentService | null = null;
let messaging: MessagingService | null = null;
let ingress: SlackIngress | null = null;
let signal: FakeSignal;
let slack: FakeSlack;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
  signal = new FakeSignal();
  await signal.start();
  slack = new FakeSlack();
  await slack.start();
});

afterEach(async () => {
  await messaging?.stop();
  messaging = null;
  ingress?.dispose();
  ingress = null;
  await slack.stop();
  await signal.stop();
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("OpenBot Slack app end to end", () => {
  it("connects a workspace, receives its events through Signal, and disconnects it", async () => {
    const started = await startService(root, { provider: "codex", autoComplete: true });
    service = started.service;
    const agent: AgentSummary = await started.store.getOrCreate("slack-agent");
    const credentials = new MemoryCredentials();
    const authorizations: Array<{ hostNonce: string; hostPublicKey: string }> = [];
    const unlinked: string[] = [];
    let routeTickets = 0;
    ingress = new SlackIngress({
      hostId: () => "host-1",
      signedIn: () => true,
      issueTicket: async () => ({ ticket: "ticket-1", signalUrl: signal.url }),
      issueSlackRoute: async () => `route-${++routeTickets}`,
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
        generate: async () => JSON.stringify({ agentId: agent.id }),
      },
      credentials,
      drivers: [slackDriver({ origin: slack.origin, ingress })],
      downloadsRoot: join(root, "messaging-downloads"),
      ingress,
      slackApp: {
        authorize: async (input) => {
          authorizations.push(input);
          return "https://slack.com/oauth/v2/authorize?client_id=openbot";
        },
        unlink: async (workspaceId) => {
          unlinked.push(workspaceId);
        },
        openExternal: async () => undefined,
      },
      slackOrigin: slack.origin,
    });
    await messaging.start();

    // The install: the bot token comes back sealed to this connect's key, and only this run opens it.
    const connect = async () => {
      await messaging?.connectSlackWorkspace();
      const authorization = authorizations.at(-1);
      if (!authorization) throw new Error("The connect did not start.");
      const grant = await sealSlackWorkspaceGrant(authorization.hostPublicKey, authorization.hostNonce, {
        botToken: BOT_TOKEN,
        botUserId: "UBOT",
        appId: "A1",
        workspaceId: "T1",
        workspaceName: "Test workspace",
      });
      expect(await messaging?.completeSlackWorkspace("another-nonce", grant)).toBe(false);
      expect(await messaging?.completeSlackWorkspace(authorization.hostNonce, grant)).toBe(true);
    };
    await connect();
    const connection = () => messaging?.slackOverview().connections[0];
    await waitFor(() => connection()?.state === "connected");
    expect(connection()).toMatchObject({ workspaceId: "T1", workspaceName: "Test workspace", credentials: "saved" });
    // The socket told Signal its workspaces with a new route ticket after the connect.
    await waitFor(() => signal.hellos.some((hello) => hello.slackRoute === "route-2"));
    expect(signal.hellos.every((hello) => hello.peer === "ingress" && hello.token === "ticket-1")).toBe(true);

    // A mention runs the agent once, however often Slack sends it. An unknown workspace is refused.
    expect(await signal.deliver("T1", mention("Ev1", "100.000"))).toEqual({ status: 200 });
    expect(await signal.deliver("T1", mention("Ev1", "100.000"))).toEqual({ status: 200 });
    await waitFor(() => slack.of("chat.update").length > 0);
    const turns = started.client.requests.filter((request) => request.method === "turn/start");
    expect(turns).toHaveLength(1);
    expect((await signal.deliver("T9", mention("Ev2", "101.000"))).status).toBe(404);
    const [link] = started.service.messaging.store.links(agent.id);
    if (!link) throw new Error("The mention has no conversation.");

    // Slack uninstalled OpenBot: the connection stops, and Signal stops routing the workspace here.
    expect(await signal.deliver("T1", { event_id: "Ev3", event: { type: "app_uninstalled" } })).toEqual({
      status: 200,
    });
    await waitFor(() => connection()?.state === "invalid_token");
    expect(unlinked).toEqual(["T1"]);

    // Connected again, the workspace keeps its conversation and its agent.
    await connect();
    await waitFor(() => connection()?.state === "connected");
    expect(started.service.messaging.store.links(agent.id).map((item) => item.linkId)).toEqual([link.linkId]);

    // Disconnect revokes the bot token, forgets it, and unlinks the workspace.
    await messaging.disconnectSlackWorkspace("T1");
    expect(slack.of("auth.revoke").map((call) => call.token)).toEqual([BOT_TOKEN]);
    expect(credentials.values.size).toBe(0);
    expect(unlinked).toEqual(["T1", "T1"]);
    expect(messaging.slackOverview().connections).toEqual([]);

    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(
      join(REPORT_DIR, "report.json"),
      `${JSON.stringify(
        {
          connected: true,
          routeTickets,
          turns: turns.length,
          unknownWorkspace: 404,
          uninstalledUnlinked: true,
          conversationKept: true,
          revoked: slack.of("auth.revoke").length,
        },
        null,
        2,
      )}\n`,
    );
  });
});
