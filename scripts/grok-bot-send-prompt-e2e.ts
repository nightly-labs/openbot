// A Grok Bot turn on the sand gateway shows the host SendMessage card in OpenBot.
// The local server stands in for api2.cursor.sh and the sand gateway. No account is used.
// bun scripts/grok-bot-send-prompt-e2e.ts
// Writes .openbot-build/grok-bot-send-prompt-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { GrokBotAccountStore } from "../src/backend/grok-bot/grok-bot-account";
import { GrokBotAgentClient } from "../src/backend/grok-bot/grok-bot-agent-client";
import { decodeThreadResponse, decodeTurnResponse } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/grok-bot-send-prompt-e2e");
const ACCESS = "grok-access-e2e";
const REFRESH = "grok-refresh-e2e";
const REPLY = "Hello from Grok Bot";
const cipher = {
  encrypt: (value: string) => Buffer.from(value, "utf8"),
  decrypt: (value: Buffer) => value.toString("utf8"),
};

const report = {
  passed: false,
  sent: false,
  noDirectStream: false,
  assistantText: "",
  turnStatus: "",
};

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((ready, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => ready(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

const root = await mkdtemp(join(tmpdir(), "openbot-grok-bot-send-"));
const authFile = join(root, "grok-account.json");
let promptSent = false;
let streamCalls = 0;
let addressPort = 0;
const eventStreams = new Set<ServerResponse>();
let pendingTurnEnded = "";

function publishTurnEnded(): void {
  pendingTurnEnded = `data: ${JSON.stringify({
    channel: "transcript",
    payload: { agentId: "sand-agent-e2e", type: "turn-ended" },
  })}\n\n`;
  for (const stream of eventStreams) {
    if (!stream.writableEnded) stream.write(pendingTurnEnded);
  }
}

const server = createServer((request, response: ServerResponse) => {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = await readBody(request);
    if (url.pathname === "/aiserver.v1.GrokBotService/EnsureSandBox") {
      response.writeHead(500).end("shared box");
      return;
    }
    if (url.pathname === "/api/createAgent") {
      assert.equal(request.headers.authorization, "Bearer gw-e2e");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ agent: { id: "sand-agent-e2e", name: "OpenBot" } }));
      return;
    }
    if (url.pathname === "/events") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      eventStreams.add(response);
      response.write(":ping\n\n");
      if (pendingTurnEnded.length > 0) response.write(pendingTurnEnded);
      response.on("close", () => eventStreams.delete(response));
      return;
    }
    if (url.pathname === "/api/sendPrompt") {
      assert.equal(request.headers.authorization, "Bearer gw-e2e");
      assert.equal(request.headers["content-type"], "application/json");
      const parsed = JSON.parse(body);
      assert.equal(isDynamicRecord(parsed) && parsed.agentId, "sand-agent-e2e");
      assert.equal(isDynamicRecord(parsed) && parsed.prompt, "hi");
      assert.equal(typeof (isDynamicRecord(parsed) ? parsed.clientNonce : ""), "string");
      assert.equal(JSON.stringify(isDynamicRecord(parsed) ? parsed.attachmentPaths : null), "[]");
      promptSent = true;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ accepted: true }));
      publishTurnEnded();
      return;
    }
    if (url.pathname === "/api/getAgentTranscriptTail") {
      const parsed = JSON.parse(body);
      assert.equal(isDynamicRecord(parsed) && parsed.id, "sand-agent-e2e");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          entries: promptSent
            ? [
                { id: "t0a0", kind: "message", role: "assistant", content: "Earlier answer" },
                { id: "t1u", kind: "message", role: "user", content: "hi" },
                {
                  id: "t1s0",
                  kind: "send-message",
                  message: { type: "text", content: REPLY },
                },
                {
                  id: "t1s1",
                  kind: "send-message",
                  message: { type: "text", content: "sent to slack", channel: "slack" },
                },
                {
                  id: "t1s2",
                  kind: "send-message",
                  message: { type: "widget", widget: { prompt: "Pick one" } },
                },
              ]
            : [],
        }),
      );
      return;
    }
    if (url.pathname === "/aiserver.v1.InferenceService/Stream") {
      streamCalls += 1;
      response.writeHead(500).end();
      return;
    }
    response.writeHead(404).end();
  })().catch((error: unknown) => {
    response.writeHead(500).end(error instanceof Error ? error.message : "failed");
  });
});

await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
const bound = server.address();
assert.ok(bound !== null && typeof bound === "object");
addressPort = bound.port;

try {
  const store = new GrokBotAccountStore(authFile, cipher);
  await Effect.runPromise(
    store.save({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      gateway: { url: `http://127.0.0.1:${addressPort}`, token: "gw-e2e", headers: {} },
    }),
  );
  const client = new GrokBotAgentClient({
    store,
    apiBaseUrl: `http://127.0.0.1:${addressPort}`,
    allowLoopback: true,
    gatewayPollMs: 20,
    gatewayTurnTimeoutMs: 500,
  });
  const notes: Array<{ method: string; params: unknown }> = [];
  client.on("notification", (notification) => notes.push(notification));
  client.start();
  const started = await Effect.runPromise(
    client.request("thread/start", { developerInstructions: "Be brief." }, decodeThreadResponse),
  );
  assert.equal(started.thread.id, "sand-agent-e2e");
  await Effect.runPromise(
    client.request(
      "turn/start",
      { threadId: started.thread.id, model: "default", input: [{ type: "text", text: "hi" }] },
      decodeTurnResponse,
    ),
  );
  await new Promise<void>((ready, reject) => {
    const timer = setTimeout(() => reject(new Error("turn did not finish")), 2_000);
    const done = () => {
      const completed = notes.find((note) => note.method === "turn/completed");
      if (!completed || !isDynamicRecord(completed.params) || !isDynamicRecord(completed.params.turn)) return;
      report.turnStatus = typeof completed.params.turn.status === "string" ? completed.params.turn.status : "";
      clearTimeout(timer);
      client.off("notification", done);
      ready();
    };
    client.on("notification", done);
    done();
  });
  const text = notes
    .filter((note) => note.method === "item/agentMessage/delta")
    .map((note) => (isDynamicRecord(note.params) && typeof note.params.delta === "string" ? note.params.delta : ""))
    .join("");
  const completedItem = notes.find((note) => note.method === "item/completed");
  const item = completedItem && isDynamicRecord(completedItem.params) ? completedItem.params.item : undefined;
  const itemText = isDynamicRecord(item) && typeof item.text === "string" ? item.text : "";
  report.sent = promptSent;
  report.noDirectStream = streamCalls === 0;
  report.assistantText = text;
  assert.equal(report.sent, true);
  assert.equal(report.noDirectStream, true);
  assert.equal(report.turnStatus, "completed");
  assert.equal(text, REPLY);
  assert.equal(itemText, REPLY);
  await Effect.runPromise(client.stop());
  report.passed = true;
} finally {
  for (const stream of eventStreams) stream.end();
  await new Promise<void>((ready, reject) => server.close((error) => (error ? reject(error) : ready())));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

if (!report.passed) process.exit(1);
