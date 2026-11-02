// Creates a Grok Bot sand agent and streams one turn through InferenceService.
// The local server stands in for api2.cursor.sh and the sand gateway. No account is used.
// bun scripts/grok-bot-agent-turn-e2e.ts
// Writes .openbot-build/grok-bot-agent-turn-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { GrokBotAccountStore } from "../src/backend/grok-bot/grok-bot-account";
import { GrokBotAgentClient } from "../src/backend/grok-bot/grok-bot-agent-client";
import { createCursorChecksum, readOrCreateMachineId } from "../src/backend/grok-bot/grok-bot-checksum";
import { GROK_BOT_RUNTIME } from "../src/backend/grok-bot/grok-bot-runtime";
import { decodeAccountReadResult, decodeThreadResponse, decodeTurnResponse } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/grok-bot-agent-turn-e2e");
const ACCESS = "grok-access-e2e";
const REFRESH = "grok-refresh-e2e";
const MACHINE = "11111111-1111-4111-8111-111111111111";
const CHECKSUM_NOW = 1_700_000_000_000;
const cipher = {
  encrypt: (value: string) => Buffer.from(value, "utf8"),
  decrypt: (value: Buffer) => value.toString("utf8"),
};

const report = {
  passed: false,
  remoteRuntime: false,
  createdOnce: false,
  streamed: false,
  resumed: false,
  usage: false,
  signedOut: false,
  checksum: false,
  tool: false,
  image: false,
  transcript: false,
  heldOpen: false,
  failedHttp: false,
  failedAuth: false,
  stopped: false,
  rawCounters: false,
  toolRoundCounters: false,
  retryCounters: false,
};

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((ready, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => ready(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function connectFrame(value: unknown, flags = 0): Buffer {
  const payload = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(5);
  header[0] = flags;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

const root = await mkdtemp(join(tmpdir(), "openbot-grok-bot-turn-"));
const authFile = join(root, "grok-account.json");
let createCalls = 0;
const streamBodies: string[] = [];
const streamAuth: string[] = [];
const streamChecksums: string[] = [];
const heldResponses: ServerResponse[] = [];
let rejectedRetry = false;

const server = createServer((request, response: ServerResponse) => {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = await readBody(request);
    if (url.pathname === "/oauth/token") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH }));
      return;
    }
    if (url.pathname === "/aiserver.v1.GrokBotService/EnsureSandBox") {
      response.writeHead(500).end("shared box");
      return;
    }
    if (url.pathname === "/api/createAgent") {
      createCalls += 1;
      assert.equal(request.headers.authorization, "Bearer gw-e2e");
      const parsed = JSON.parse(body);
      assert.equal(isDynamicRecord(parsed) && parsed.origin, "user");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ agent: { id: "sand-agent-e2e", name: "OpenBot" } }));
      return;
    }
    if (url.pathname === "/api/listAgents") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ agents: [{ id: "sand-agent-e2e", name: "OpenBot" }] }));
      return;
    }
    if (url.pathname === "/api/getAgentTranscriptTail") {
      const parsed = JSON.parse(body);
      assert.equal(isDynamicRecord(parsed) && parsed.id, "sand-agent-e2e");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          entries: [
            { id: "t0u", kind: "message", role: "user", text: "Earlier question" },
            { id: "t0a0", kind: "message", role: "assistant", text: "Earlier answer" },
          ],
        }),
      );
      return;
    }
    if (url.pathname === "/aiserver.v1.InferenceService/Stream") {
      streamAuth.push(request.headers.authorization ?? "");
      streamChecksums.push(String(request.headers["x-cursor-checksum"] ?? ""));
      streamBodies.push(body.slice(5));
      assert.equal(request.headers.authorization, `Bearer ${ACCESS}`);
      assert.equal(request.headers["connect-protocol-version"], "1");
      assert.equal(request.headers["x-cursor-client-type"], "sand");
      assert.equal(request.headers["content-type"], "application/connect+json");
      if (body.includes("status-415")) {
        response.writeHead(415, { "content-type": "text/plain" });
        response.end("Unsupported Media Type");
        return;
      }
      if (body.includes("status-auth")) {
        response.writeHead(200, { "content-type": "application/connect+json" });
        response.end(
          Buffer.concat([
            connectFrame({ textPart: { text: "partial", isFinal: false } }),
            connectFrame({ error: { code: "unauthenticated", message: "Error" } }),
          ]),
        );
        return;
      }
      if (body.includes("hold-open")) {
        response.writeHead(200, { "content-type": "application/connect+json" });
        response.write(
          Buffer.concat([connectFrame({ textPart: { text: "Held reply", isFinal: true } }), connectFrame({}, 0x02)]),
        );
        heldResponses.push(response);
        return;
      }
      if (body.includes("status-hang")) {
        response.writeHead(200, { "content-type": "application/connect+json" });
        heldResponses.push(response);
        return;
      }
      const toolFollowUp = body.includes("toolContent");
      const toolRequest = body.includes("use-tool") && !toolFollowUp;
      response.writeHead(200, { "content-type": "application/connect+json" });
      if (body.includes("retry-auth") && !rejectedRetry) {
        rejectedRetry = true;
        response.end(
          Buffer.concat([
            connectFrame({ usage: { promptTokens: 6, completionTokens: 0 } }),
            connectFrame({ error: { code: "unauthenticated" } }, 0x02),
          ]),
        );
        return;
      }
      response.end(
        Buffer.concat(
          toolRequest
            ? [
                connectFrame({
                  toolCallPart: {
                    toolCallId: "call-1",
                    toolName: "openbot.echo",
                    args: '{"text":"hi"}',
                    isComplete: true,
                  },
                }),
                connectFrame({ usage: { promptTokens: 10, completionTokens: 2 } }),
                connectFrame({}, 0x02),
              ]
            : [
                connectFrame({ textPart: { text: toolFollowUp ? "Tool done" : "Hello", isFinal: false } }),
                connectFrame({
                  textPart: { text: toolFollowUp ? "" : " from Grok Bot", isFinal: false },
                }),
                connectFrame({ textPart: { text: "", isFinal: true } }),
                connectFrame({ usage: { promptTokens: 4, completionTokens: 3, totalTokens: 7 } }),
                connectFrame({}, 0x02),
              ],
        ),
      );
      return;
    }
    if (url.pathname === "/aiserver.v1.DashboardService/GetSandUsageStatus") {
      assert.equal(request.headers.authorization, `Bearer ${ACCESS}`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ sandUsagePercent: 41, hasAvailableUsage: true }));
      return;
    }
    if (url.pathname.startsWith("/aiserver.v1.DashboardService/")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
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
const addressPort = bound.port;
const apiBaseUrl = `http://127.0.0.1:${addressPort}`;

function clientFor(store: GrokBotAccountStore): GrokBotAgentClient {
  return new GrokBotAgentClient({
    store,
    apiBaseUrl,
    allowLoopback: true,
    requestTimeoutMs: 5_000,
    machineId: MACHINE,
    checksumNow: () => CHECKSUM_NOW,
    directInference: true,
  });
}

try {
  report.remoteRuntime =
    GROK_BOT_RUNTIME.remote === true && GROK_BOT_RUNTIME.executable === "" && GROK_BOT_RUNTIME.version === "remote";
  assert.equal(report.remoteRuntime, true);

  const empty = new GrokBotAccountStore(join(root, "empty.json"), cipher);
  const signedOut = clientFor(empty);
  signedOut.start();
  const missing = await Effect.runPromise(signedOut.request("account/read", {}, decodeAccountReadResult));
  report.signedOut = missing.account === null;
  assert.equal(report.signedOut, true);
  await Effect.runPromise(signedOut.stop());

  const store = new GrokBotAccountStore(authFile, cipher);
  await Effect.runPromise(
    store.save({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      gateway: { url: apiBaseUrl, token: "gw-e2e", headers: { "x-anyrun-network-token": "net-e2e" } },
    }),
  );
  const client = clientFor(store);
  const notes: Array<{ method: string; params: unknown }> = [];
  const diagnostics: string[] = [];
  client.on("notification", (notification) => notes.push(notification));
  client.on("diagnostic", (line) => diagnostics.push(line));
  client.start();
  const account = await Effect.runPromise(client.request("account/read", {}, decodeAccountReadResult));
  assert.equal(account.account?.type, "grok-bot");
  const models = await Effect.runPromise(client.request("model/list", {}, (value) => value));
  assert.equal(isDynamicRecord(models) && Array.isArray(models.data) && models.data[0]?.model, "default");
  const started = await Effect.runPromise(
    client.request(
      "thread/start",
      { openbotAgentId: "local-agent", developerInstructions: "Be brief." },
      decodeThreadResponse,
    ),
  );
  assert.equal(started.thread.id, "sand-agent-e2e");
  const turn = await Effect.runPromise(
    client.request(
      "turn/start",
      {
        threadId: started.thread.id,
        model: "default",
        input: [{ type: "text", text: "Hello" }],
      },
      decodeTurnResponse,
    ),
  );
  assert.equal(turn.turn.status, "inProgress");
  await new Promise<void>((ready, reject) => {
    const timer = setTimeout(() => reject(new Error("turn did not finish")), 2_000);
    const done = () => {
      if (!notes.some((note) => note.method === "turn/completed")) return;
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
  report.streamed = text === "Hello from Grok Bot";
  assert.equal(report.streamed, true);
  const usagePrefix = "Grok Bot direct inference token counts: ";
  const firstDiagnostic = diagnostics.find((line) => line.startsWith(usagePrefix));
  assert.ok(firstDiagnostic);
  assert.equal(redactText(firstDiagnostic), firstDiagnostic);
  assert.deepEqual(JSON.parse(firstDiagnostic.slice(usagePrefix.length)), {
    turnId: turn.turn.id,
    round: 0,
    attempt: 1,
    counts: { prompt: 4, completion: 3, total: 7, input: null, output: null, cacheRead: null, cacheWrite: null },
  });
  report.rawCounters = true;
  const first = JSON.parse(streamBodies[0] ?? "{}");
  assert.equal(isDynamicRecord(first) && first.conversationId, "sand-agent-e2e");
  assert.equal(
    isDynamicRecord(first) && isDynamicRecord(first.requestedModel) && first.requestedModel.modelId,
    "default",
  );
  const firstMessages = isDynamicRecord(first) && Array.isArray(first.messages) ? first.messages : [];
  assert.equal(
    firstMessages.some((message) => isDynamicRecord(message) && message.role === "USER" && message.text === "Hello"),
    true,
  );
  assert.equal(streamAuth[0], `Bearer ${ACCESS}`);
  assert.equal(streamAuth[0]?.includes("gw-e2e"), false);
  report.checksum = streamChecksums[0] === createCursorChecksum(MACHINE, CHECKSUM_NOW);
  assert.equal(report.checksum, true);

  const again = clientFor(store);
  again.start();
  await Effect.runPromise(again.request("thread/resume", { threadId: "sand-agent-e2e" }, decodeThreadResponse));
  const secondPosted = new Promise<string>((ready, reject) => {
    const timer = setTimeout(() => reject(new Error("the resumed turn did not reach InferenceService")), 2_000);
    const previous = streamBodies.length;
    const timerId = setInterval(() => {
      const body = streamBodies[previous];
      if (body === undefined) return;
      clearInterval(timerId);
      clearTimeout(timer);
      ready(body);
    }, 5);
  });
  await Effect.runPromise(
    again.request(
      "turn/start",
      { threadId: "sand-agent-e2e", model: "default", input: [{ type: "text", text: "Again" }] },
      decodeTurnResponse,
    ),
  );
  const second = JSON.parse(await secondPosted);
  report.resumed = isDynamicRecord(second) && second.conversationId === "sand-agent-e2e" && createCalls === 1;
  assert.equal(report.resumed, true);
  report.transcript =
    JSON.stringify(second).includes("Earlier question") && JSON.stringify(second).includes("Earlier answer");
  assert.equal(report.transcript, true);

  const imagePath = join(root, "dot.png");
  await writeFile(imagePath, Buffer.from("png-bytes"));
  const imageNotes: Array<{ method: string; params: unknown }> = [];
  client.on("notification", (notification) => imageNotes.push(notification));
  const imagePosted = new Promise<string>((ready, reject) => {
    const timer = setTimeout(() => reject(new Error("the image turn did not reach InferenceService")), 2_000);
    const previous = streamBodies.length;
    const timerId = setInterval(() => {
      const posted = streamBodies[previous];
      if (posted === undefined) return;
      clearInterval(timerId);
      clearTimeout(timer);
      ready(posted);
    }, 5);
  });
  await Effect.runPromise(
    client.request(
      "turn/start",
      {
        threadId: started.thread.id,
        model: "default",
        input: [
          { type: "text", text: "See this" },
          { type: "localImage", path: imagePath },
        ],
      },
      decodeTurnResponse,
    ),
  );
  const imageBody = await imagePosted;
  report.image =
    imageBody.includes("data:image/png;base64,") && imageBody.includes(Buffer.from("png-bytes").toString("base64"));
  assert.equal(report.image, true);
  await new Promise<void>((ready, reject) => {
    const timer = setTimeout(() => reject(new Error("image turn did not finish")), 2_000);
    const done = () => {
      if (!imageNotes.some((note) => note.method === "turn/completed")) return;
      clearTimeout(timer);
      client.off("notification", done);
      ready();
    };
    client.on("notification", done);
    done();
  });

  client.on("request", (request) => {
    if (request.method !== "item/tool/call") return;
    const params = request.params;
    assert.equal(isDynamicRecord(params) && params.namespace, "openbot");
    assert.equal(isDynamicRecord(params) && params.tool, "echo");
    client.respond(request.id, {
      success: true,
      contentItems: [{ type: "inputText", text: "echoed hi" }],
    });
  });
  const toolNotes: Array<{ method: string; params: unknown }> = [];
  client.on("notification", (notification) => toolNotes.push(notification));
  const toolTurn = await Effect.runPromise(
    client.request(
      "turn/start",
      {
        threadId: started.thread.id,
        model: "default",
        dynamicTools: [
          {
            type: "namespace",
            name: "openbot",
            tools: [{ type: "function", name: "echo", description: "Echo text", inputSchema: { type: "object" } }],
          },
        ],
        input: [{ type: "text", text: "use-tool" }],
      },
      decodeTurnResponse,
    ),
  );
  await new Promise<void>((ready, reject) => {
    const timer = setTimeout(() => reject(new Error("tool turn did not finish")), 2_000);
    const done = () => {
      const completed = toolNotes.find((note) => note.method === "turn/completed");
      if (!completed || !isDynamicRecord(completed.params)) return;
      const turnRecord = completed.params.turn;
      if (!isDynamicRecord(turnRecord) || turnRecord.status !== "completed") return;
      clearTimeout(timer);
      client.off("notification", done);
      ready();
    };
    client.on("notification", done);
    done();
  });
  const toolReply = toolNotes
    .filter((note) => note.method === "item/agentMessage/delta")
    .map((note) => (isDynamicRecord(note.params) && typeof note.params.delta === "string" ? note.params.delta : ""))
    .join("");
  report.tool = toolReply === "Tool done" && streamBodies.some((body) => body.includes("echoed hi"));
  assert.equal(report.tool, true);
  const toolCounters = diagnostics
    .filter((line) => line.startsWith(usagePrefix))
    .map((line) => JSON.parse(line.slice(usagePrefix.length)))
    .filter((value) => value.turnId === toolTurn.turn.id);
  assert.equal(toolCounters.length, 2);
  assert.deepEqual(
    toolCounters.map((value) => value.round),
    [0, 1],
  );
  assert.deepEqual(
    toolCounters.map((value) => value.counts.prompt),
    [10, 4],
  );
  assert.deepEqual(
    toolCounters.map((value) => value.counts.total),
    [null, 7],
  );
  report.toolRoundCounters = true;

  const retried = new Promise<void>((ready, reject) => {
    const deadline = setTimeout(() => reject(new Error("retry turn did not finish")), 2000);
    client.on("notification", (note) => {
      if (note.method !== "turn/completed") return;
      clearTimeout(deadline);
      ready();
    });
  });
  const retryTurn = await Effect.runPromise(
    client.request(
      "turn/start",
      {
        threadId: started.thread.id,
        model: "default",
        input: [{ type: "text", text: "retry-auth" }],
      },
      decodeTurnResponse,
    ),
  );
  await retried;
  const retryCounters = diagnostics
    .filter((line) => line.startsWith(usagePrefix))
    .map((line) => JSON.parse(line.slice(usagePrefix.length)))
    .filter((value) => value.turnId === retryTurn.turn.id);
  assert.deepEqual(
    retryCounters.map((value) => value.attempt),
    [1, 2],
  );
  assert.deepEqual(
    retryCounters.map((value) => value.counts.prompt),
    [6, 4],
  );
  report.retryCounters = true;

  const machinePath = join(root, "machine-id");
  const firstId = await readOrCreateMachineId(machinePath, () => MACHINE);
  const secondId = await readOrCreateMachineId(machinePath, () => "22222222-2222-4222-8222-222222222222");
  assert.equal(firstId, MACHINE);
  assert.equal(secondId, MACHINE);
  assert.equal((await readFile(machinePath, "utf8")).trim(), MACHINE);
  report.createdOnce = createCalls === 1;

  const terminalNotes: Array<{ method: string; params: unknown }> = [];
  client.on("notification", (notification) => terminalNotes.push(notification));
  const waitForTerminal = (text: string, status: string) =>
    new Promise<void>((ready, reject) => {
      const timer = setTimeout(() => reject(new Error(`${text} turn did not finish`)), 2_000);
      const done = () => {
        const completed = terminalNotes.find((note) => {
          if (note.method !== "turn/completed" || !isDynamicRecord(note.params)) return false;
          const turnRecord = note.params.turn;
          if (!isDynamicRecord(turnRecord) || turnRecord.status !== status) return false;
          const error = turnRecord.error;
          if (status === "failed") {
            return isDynamicRecord(error) && typeof error.message === "string" && error.message.includes(text);
          }
          return true;
        });
        if (!completed) return;
        clearTimeout(timer);
        client.off("notification", done);
        ready();
      };
      client.on("notification", done);
      done();
    });

  await Effect.runPromise(
    client.request(
      "turn/start",
      { threadId: started.thread.id, model: "default", input: [{ type: "text", text: "status-415" }] },
      decodeTurnResponse,
    ),
  );
  await waitForTerminal("HTTP 415", "failed");
  report.failedHttp = true;

  await Effect.runPromise(
    client.request(
      "turn/start",
      { threadId: started.thread.id, model: "default", input: [{ type: "text", text: "status-auth" }] },
      decodeTurnResponse,
    ),
  );
  await waitForTerminal("unauthenticated: Error", "failed");
  report.failedAuth = true;

  const heldBefore = heldResponses.length;
  await Effect.runPromise(
    client.request(
      "turn/start",
      { threadId: started.thread.id, model: "default", input: [{ type: "text", text: "hold-open" }] },
      decodeTurnResponse,
    ),
  );
  await waitForTerminal("hold-open", "completed");
  const heldText = terminalNotes
    .filter((note) => note.method === "item/agentMessage/delta" || note.method === "item/completed")
    .map((note) => {
      if (!isDynamicRecord(note.params)) return "";
      if (typeof note.params.delta === "string") return note.params.delta;
      const item = note.params.item;
      return isDynamicRecord(item) && typeof item.text === "string" ? item.text : "";
    })
    .join("");
  const held = heldResponses[heldBefore];
  report.heldOpen = heldText.includes("Held reply") && held !== undefined;
  assert.equal(report.heldOpen, true);

  await Effect.runPromise(
    client.request(
      "turn/start",
      { threadId: started.thread.id, model: "default", input: [{ type: "text", text: "status-hang" }] },
      decodeTurnResponse,
    ),
  );
  await Effect.runPromise(client.stop());
  await waitForTerminal("status-hang", "interrupted");
  report.stopped = true;

  const limits = await Effect.runPromise(again.request("account/rateLimits/read", {}, (value) => value));
  const primary = isDynamicRecord(limits) && isDynamicRecord(limits.rateLimits) ? limits.rateLimits.primary : undefined;
  report.usage = isDynamicRecord(primary) && primary.usedPercent === 41;
  assert.equal(report.usage, true);
  await Effect.runPromise(client.stop());
  await Effect.runPromise(again.stop());
  report.passed = true;
} finally {
  for (const heldResponse of heldResponses) {
    if (!heldResponse.writableEnded) heldResponse.end();
  }
  await new Promise<void>((ready, reject) => server.close((error) => (error ? reject(error) : ready())));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

if (!report.passed) process.exit(1);
