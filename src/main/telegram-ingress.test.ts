// @vitest-environment node

// The host half of the Telegram frames on the real `SignalIngress` socket. Signal is a local
// WebSocket server. A Signal without the `telegram` capability must get no Telegram frame: Signal
// closes a socket on a frame it does not know, and that would stop Slack and Discord on the same socket.
// Signal's own checks are in `remote/api/test`.

import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import { waitFor } from "../backend/agent-service-test-harness";
import { TelegramCallError } from "../backend/messaging/messaging-types";
import { SignalIngress } from "./signal-ingress";

class FakeSignal {
  readonly frames: DynamicRecord[] = [];
  #server: WebSocketServer | null = null;
  #socket: WebSocket | null = null;
  url = "";

  constructor(readonly capabilities: string[] | undefined) {}

  async start(): Promise<void> {
    this.#server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    this.#server.on("connection", (socket) => {
      socket.on("message", (data) => {
        const frame = JSON.parse(data.toString());
        if (!isDynamicRecord(frame)) return;
        this.frames.push(frame);
        if (frame.type === "hello") {
          this.#socket = socket;
          socket.send(
            JSON.stringify({
              type: "ready",
              version: 1,
              connectionId: null,
              resumeToken: "r",
              iceServers: [],
              ...(this.capabilities ? { capabilities: this.capabilities } : {}),
            }),
          );
        } else if (frame.type === "telegram-call") {
          const params = isDynamicRecord(frame.params) ? frame.params : {};
          socket.send(
            JSON.stringify(
              params.chat_id === 1
                ? {
                    type: "telegram-call-result",
                    version: 1,
                    requestId: frame.requestId,
                    ok: true,
                    result: { messageId: 77 },
                  }
                : {
                    type: "telegram-call-result",
                    version: 1,
                    requestId: frame.requestId,
                    ok: false,
                    errorCode: 403,
                    description: "forbidden",
                  },
            ),
          );
        }
      });
    });
    await new Promise<void>((resolve) => this.#server?.once("listening", resolve));
    const address = this.#server.address();
    if (!address || typeof address === "string") throw new Error("The fake Signal has no port.");
    this.url = `ws://127.0.0.1:${address.port}`;
  }

  deliver(body: string): void {
    this.#socket?.send(
      JSON.stringify({
        type: "telegram-delivery",
        version: 1,
        botId: "700",
        chatId: "-100",
        bodyBase64: Buffer.from(body).toString("base64"),
      }),
    );
  }

  async stop(): Promise<void> {
    for (const client of this.#server?.clients ?? []) client.terminate();
    await new Promise<void>((resolve) => this.#server?.close(() => resolve()));
  }
}

let signal: FakeSignal | null = null;
let ingress: SignalIngress | null = null;

afterEach(async () => {
  if (ingress) await Effect.runPromise(ingress.dispose());
  ingress = null;
  await signal?.stop();
  signal = null;
});

async function open(capabilities: string[] | undefined): Promise<{ signal: FakeSignal; ingress: SignalIngress }> {
  const fake = new FakeSignal(capabilities);
  await fake.start();
  signal = fake;
  const created = new SignalIngress({
    hostId: () => "host-1",
    signedIn: () => true,
    issueTicket: () => Effect.succeed({ ticket: "ticket-1", signalUrl: fake.url }),
    issueSlackRoute: () => Effect.succeed("slack-route"),
    issueDiscordRoute: () => Effect.succeed("discord-route"),
    issueWebhookRoute: () => Effect.succeed("webhook-route"),
    issueTelegramRoute: () => Effect.succeed("telegram-route"),
  });
  ingress = created;
  created.acquire("slack");
  created.acquire("telegram");
  await waitFor(() => created.state() === "online");
  return { signal: fake, ingress: created };
}

describe.sequential("Telegram on the ingress socket", () => {
  it("sends no Telegram frame to a Signal without the telegram capability", async () => {
    const { signal, ingress } = await open(undefined);
    expect(signal.frames[0]).toMatchObject({
      type: "hello",
      slackRoute: "slack-route",
      telegramRoute: "telegram-route",
    });
    expect(ingress.telegram.available()).toBe(false);
    const result = await Effect.runPromise(Effect.result(ingress.telegram.call("700", "leaveChat", { chat_id: 1 })));
    expect(Result.isFailure(result)).toBe(true);
    expect(signal.frames.map((frame) => frame.type)).toEqual(["hello"]);
  });

  it("carries calls and their failures, and passes each update to the handler", async () => {
    const { signal, ingress } = await open(["telegram"]);
    expect(ingress.telegram.available()).toBe(true);
    const sent = await Effect.runPromise(
      ingress.telegram.call("700", "sendMessage", { chat_id: 1, text: "hi", parse_mode: "HTML" }),
    );
    expect(sent).toEqual({ messageId: 77 });
    expect(signal.frames.find((frame) => frame.type === "telegram-call")).toMatchObject({
      botId: "700",
      method: "sendMessage",
      params: { chat_id: 1, text: "hi", parse_mode: "HTML" },
    });

    const refused = await Effect.runPromise(Effect.result(ingress.telegram.call("700", "leaveChat", { chat_id: 2 })));
    const cause = Result.isFailure(refused) ? refused.failure.cause : null;
    expect(cause).toBeInstanceOf(TelegramCallError);
    expect(cause instanceof TelegramCallError ? cause.errorCode : 0).toBe(403);

    const received: string[] = [];
    ingress.handle((chatId, delivery) =>
      Effect.sync(() => {
        if (delivery.platform === "telegram")
          received.push(`${delivery.botId}:${chatId}:${Buffer.from(delivery.body).toString()}`);
        return { status: 200 as const };
      }),
    );
    signal.deliver('{"update_id":1}');
    await waitFor(() => received.length === 1);
    expect(received).toEqual(['700:-100:{"update_id":1}']);
  });
});
