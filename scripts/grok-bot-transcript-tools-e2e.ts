// A Grok Bot gateway turn shows sand tool rows from the transcript.
// The local server stands in for api2.cursor.sh and the sand gateway. No account is used.
// OpenBot does not call item/tool/call.
// bun scripts/grok-bot-transcript-tools-e2e.ts
// Writes .openbot-build/grok-bot-transcript-tools-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { GrokBotAccountStore } from "../src/backend/grok-bot/grok-bot-account";
import { GrokBotAgentClient } from "../src/backend/grok-bot/grok-bot-agent-client";
import {
  transcriptActivityAfterPrompt,
  transcriptToMessages,
  transcriptToolSteps,
} from "../src/backend/grok-bot/grok-bot-transcript";
import { decodeThreadResponse, decodeTurnResponse } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/grok-bot-transcript-tools-e2e");
const REPLY = "Hello from Grok Bot";
const TOOL_REPLY = "Done with the tool";
const WAIT_REPLY = "Finished after the tool";
const FAIL_REPLY = "The tool failed";
const PERMISSION_REPLY = "Allowed";
const WINDOW_REPLY = "Reply after a full tail";
const WINDOW_PROMPT = "windowed tail";
/** Same cap as `readGrokBotTranscript` (`limit: 200`). */
const TAIL_LIMIT = 200;
const INTERIM_REPLY = "Checking your computer's date now.";
const FINAL_REPLY = "It is Friday, Oct 30.";
const cipher = {
  encrypt: (value: string) => Buffer.from(value, "utf8"),
  decrypt: (value: Buffer) => value.toString("utf8"),
};

const report: {
  passed: boolean;
  textReply: string;
  toolNames: string[];
  toolStatuses: string[];
  waitingHeld: boolean;
  permissionHeld: boolean;
  failedToolStatus: string;
  interimHeld: boolean;
  longToolHeld: boolean;
  retryingHeld: boolean;
  subagentHeld: boolean;
  rosterEnded: boolean;
  windowedTail: boolean;
  quietFallback: boolean;
  writingShown: boolean;
  usageInputTokens: number;
  noToolCallRequest: boolean;
  noDirectStream: boolean;
  directInferenceOmitted: boolean;
} = {
  passed: false,
  textReply: "",
  toolNames: [],
  toolStatuses: [],
  waitingHeld: false,
  permissionHeld: false,
  failedToolStatus: "",
  interimHeld: false,
  longToolHeld: false,
  retryingHeld: false,
  subagentHeld: false,
  rosterEnded: false,
  windowedTail: false,
  quietFallback: false,
  writingShown: false,
  usageInputTokens: 0,
  noToolCallRequest: false,
  noDirectStream: false,
  directInferenceOmitted: false,
};

const textTail = {
  entries: [
    { id: "t1u", kind: "message", role: "user", content: "text only" },
    { kind: "not-a-card", id: "mystery" },
    { id: "t1s0", kind: "send-message", message: { type: "text", content: REPLY } },
    { id: "t1s1", kind: "send-message", message: { type: "text", content: "sent to slack", channel: "slack" } },
  ],
};

const toolTail = {
  entries: [
    { id: "t0u", kind: "message", role: "user", content: "old" },
    { id: "t0c", kind: "tool-call", name: "Read", status: "done", summary: "old file" },
    { id: "t0s", kind: "send-message", message: { type: "text", content: "old reply" } },
    { id: "t2u", kind: "message", role: "user", content: "use the tool" },
    { kind: "not-a-card", id: "mystery-2" },
    { id: "t2c0", kind: "tool-call", name: "Shell", status: "done", summary: "listed files" },
    { id: "t2c1", kind: "tool-call", toolName: "Read", status: "done", summary: "notes" },
    { id: "", kind: "tool-call", name: "Skip", status: "done" },
    { id: "t2c2", kind: "tool-call", name: "", status: "done" },
    { id: "t2s0", kind: "send-message", message: { type: "text", content: TOOL_REPLY } },
  ],
};

function oneToolTail() {
  return {
    entries: [
      { id: "t9u", kind: "message", role: "user", content: "one tool" },
      { kind: "not-a-card", noise: true },
      { id: "t9c", kind: "tool-call", name: "Shell", status: "done", summary: "listed files" },
      { id: "t9s", kind: "send-message", message: { type: "text", content: "One sentence" } },
    ],
  };
}

function assertParser(): void {
  const odd = transcriptToolSteps({ entries: [null, 1, "x", { kind: "tool-call" }] });
  assert.deepEqual(odd, []);
  assert.deepEqual(transcriptToolSteps(null), []);
  assert.deepEqual(transcriptToolSteps(textTail), []);
  const textMessage = transcriptToMessages(textTail).at(-1);
  assert.equal(textMessage && "text" in textMessage ? textMessage.text : "", REPLY);

  const one = transcriptToolSteps(oneToolTail());
  assert.equal(one.length, 1);
  assert.equal(one[0]?.name, "Shell");
  assert.equal(one[0]?.status, "completed");
  assert.equal(one[0]?.detail, "listed files");
  const oneMessage = transcriptToMessages(oneToolTail()).at(-1);
  assert.equal(oneMessage && "text" in oneMessage ? oneMessage.text : "", "One sentence");

  const after = transcriptActivityAfterPrompt(toolTail, "use the tool");
  assert.deepEqual(
    after.steps.map((step) => step.name),
    ["Shell", "Read"],
  );
  assert.equal(after.permissionPending, false);
  assert.equal(
    transcriptToolSteps(toolTail).some((step) => step.id === "t0c"),
    true,
  );

  const failed = transcriptToolSteps({
    entries: [{ id: "e", kind: "tool-call", name: "Shell", status: "error", summary: "disk full" }],
  });
  assert.equal(failed[0]?.status, "failed");
  const pending = transcriptToolSteps({
    entries: [{ id: "p", kind: "tool-call", name: "Shell", status: "running" }],
  });
  assert.equal(pending[0]?.status, "inProgress");
  const aborted = transcriptToolSteps({
    entries: [{ id: "a", kind: "tool-call", name: "Shell", status: "aborted" }],
  });
  assert.equal(aborted[0]?.status, "completed");
  const named = transcriptToolSteps({
    entries: [{ id: "n", kind: "tool-call", toolName: "Read", status: "done" }],
  });
  assert.equal(named[0]?.name, "Read");
  assert.equal(named[0]?.detail, "");
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((ready, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => ready(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

type Mode =
  | "text"
  | "tool"
  | "wait"
  | "fail"
  | "permission"
  | "interim"
  | "long"
  | "retrying"
  | "subagent"
  | "roster"
  | "window"
  | "quiet";

const TEXT_USAGE = { inputTokens: 11, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 1 };
const LONG_HOLD_MS = 13_000;

assertParser();

const drivers = readFileSync(resolve(import.meta.dirname, "../src/backend/provider-drivers.ts"), "utf8");
const grokBot = drivers.slice(drivers.indexOf('id: "grok-bot"'), drivers.indexOf('id: "acp"'));
report.directInferenceOmitted = !grokBot.includes("directInference");
assert.equal(report.directInferenceOmitted, true);

const root = await mkdtemp(join(tmpdir(), "openbot-grok-bot-tools-"));
const authFile = join(root, "grok-account.json");
let mode: Mode = "text";
let arm = false;
let polls = 0;
let rosterPolls = 0;
let released = false;
let armedAt = 0;
let streamCalls = 0;
let addressPort = 0;
let eventsOpen = true;
let rosterRunningField = false;
let running = false;
let composing = false;
let retryingFlag = false;
let longReady = false;
const toolRequests: string[] = [];
const eventStreams = new Set<ServerResponse>();
const timers: ReturnType<typeof setTimeout>[] = [];

function clearTimers(): void {
  for (const timer of timers) clearTimeout(timer);
  timers.length = 0;
}

function configure(next: Mode): void {
  mode = next;
  eventsOpen = next !== "roster" && next !== "quiet";
  rosterRunningField = next === "roster";
  running = false;
  composing = false;
  retryingFlag = false;
  longReady = false;
  arm = false;
  polls = 0;
  rosterPolls = 0;
  released = false;
  clearTimers();
}

function publish(channel: string, payload: unknown): void {
  const line = `data: ${JSON.stringify({ channel, payload })}\n\n`;
  for (const stream of eventStreams) {
    if (!stream.writableEnded) stream.write(line);
  }
}

function publishAgent(): void {
  publish("agents", {
    agents: [
      {
        id: "sand-agent-e2e",
        name: "OpenBot",
        isRunning: running,
        isComposingMessage: composing,
        isRetrying: retryingFlag,
      },
    ],
  });
}

function publishEnded(usage?: unknown): void {
  running = false;
  composing = false;
  retryingFlag = false;
  publish("transcript", {
    agentId: "sand-agent-e2e",
    type: "turn-ended",
    ...(usage ? { usage } : {}),
  });
  publishAgent();
}

function armTurn(): void {
  arm = true;
  armedAt = Date.now();
  polls = 0;
  rosterPolls = 0;
  released = false;
  longReady = false;
  clearTimers();
  if (!eventsOpen) {
    if (mode === "roster") running = true;
    return;
  }
  if (mode === "text" || mode === "window") {
    running = true;
    publishAgent();
    publishEnded(TEXT_USAGE);
    return;
  }
  if (mode === "tool" || mode === "fail") {
    running = true;
    publishAgent();
    publishEnded();
    return;
  }
  if (mode === "wait" || mode === "permission") {
    running = true;
    publishAgent();
    return;
  }
  if (mode === "interim") {
    running = true;
    composing = true;
    publishAgent();
    timers.push(setTimeout(() => publishEnded(), 500));
    return;
  }
  if (mode === "long") {
    running = true;
    publishAgent();
    timers.push(
      setTimeout(() => {
        longReady = true;
        publishEnded();
      }, LONG_HOLD_MS),
    );
    return;
  }
  if (mode === "retrying") {
    running = true;
    retryingFlag = true;
    publishAgent();
    timers.push(setTimeout(() => publishEnded(), 500));
    return;
  }
  running = true;
  publishAgent();
  publish("transcript", { agentId: "sand-agent-e2e", type: "turn-ended" });
  timers.push(
    setTimeout(() => {
      running = false;
      publishAgent();
    }, 500),
  );
}

/** A full tail. The new prompt replaces the two oldest rows, so both windows have `TAIL_LIMIT` rows. */
function windowTail(armed: boolean): unknown[] {
  const keep = armed ? TAIL_LIMIT - 2 : TAIL_LIMIT;
  const entries: unknown[] = [];
  for (let index = 0; index < keep; index += 1) {
    entries.push({ id: `old${index}`, kind: "message", role: "user", content: `older ${index}` });
  }
  if (!armed) return entries;
  entries.push({ id: "tWu", kind: "message", role: "user", content: WINDOW_PROMPT });
  entries.push({ id: "tWs", kind: "send-message", message: { type: "text", content: WINDOW_REPLY } });
  return entries;
}

function liveEntries(): unknown[] {
  if (mode === "window") return windowTail(true);
  if (mode === "text") return textTail.entries;
  if (mode === "tool") return toolTail.entries;
  if (mode === "fail") {
    return [
      { id: "t4u", kind: "message", role: "user", content: "tool fails" },
      { id: "t4c", kind: "tool-call", name: "Shell", status: "error", summary: "disk full" },
      { id: "t4s", kind: "send-message", message: { type: "text", content: FAIL_REPLY } },
    ];
  }
  if (mode === "interim") {
    const age = Date.now() - armedAt;
    const rows: unknown[] = [
      { id: "t6u", kind: "message", role: "user", content: "date on my computer" },
      { id: "t6s0", kind: "send-message", message: { type: "text", content: INTERIM_REPLY } },
    ];
    if (age >= 150) {
      const done = age >= 300;
      rows.push({ id: "t6c", kind: "tool-call", name: "Shell", status: done ? "done" : "running", summary: "date" });
      if (done) rows.push({ id: "t6s1", kind: "send-message", message: { type: "text", content: FINAL_REPLY } });
    }
    return rows;
  }
  if (mode === "long") {
    const rows: unknown[] = [
      { id: "t7u", kind: "message", role: "user", content: "long tool" },
      { id: "t7s0", kind: "send-message", message: { type: "text", content: "Working on a long tool." } },
    ];
    if (longReady) {
      rows.push({ id: "t7c", kind: "tool-call", name: "Shell", status: "done", summary: "finished" });
      rows.push({ id: "t7s1", kind: "send-message", message: { type: "text", content: "Long tool done." } });
    }
    return rows;
  }
  if (mode === "retrying") {
    return [
      { id: "t8u", kind: "message", role: "user", content: "retry this" },
      { id: "t8s", kind: "send-message", message: { type: "text", content: "Retried reply" } },
    ];
  }
  if (mode === "subagent") {
    return [
      { id: "t9u", kind: "message", role: "user", content: "subagent holds" },
      { id: "t9s", kind: "send-message", message: { type: "text", content: "Parent still running" } },
    ];
  }
  if (mode === "roster") {
    return [
      { id: "t10u", kind: "message", role: "user", content: "roster signal" },
      { id: "t10s", kind: "send-message", message: { type: "text", content: "Roster reply" } },
    ];
  }
  if (mode === "quiet") {
    return [
      { id: "t11u", kind: "message", role: "user", content: "quiet fallback" },
      { id: "t11s", kind: "send-message", message: { type: "text", content: "Quiet reply" } },
    ];
  }
  const open = !released;
  if (mode === "wait") {
    return [
      { id: "t3u", kind: "message", role: "user", content: "wait for the tool" },
      {
        id: "t3c",
        kind: "tool-call",
        name: "Shell",
        status: open ? "running" : "done",
        summary: open ? "still running" : "listed files",
      },
      { id: "t3s", kind: "send-message", message: { type: "text", content: WAIT_REPLY } },
    ];
  }
  return [
    { id: "t5u", kind: "message", role: "user", content: "need permission" },
    {
      id: "t5p",
      kind: "send-message",
      message: {
        type: "local-tool-permission",
        ask: { requestId: "r1", status: open ? "pending" : "allow-once", action: "read-file" },
      },
    },
    { id: "t5s", kind: "send-message", message: { type: "text", content: PERMISSION_REPLY } },
  ];
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
      if (!eventsOpen) {
        response.writeHead(404).end();
        return;
      }
      eventStreams.add(response);
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      response.write(":ping\n\n");
      response.on("close", () => eventStreams.delete(response));
      return;
    }
    if (url.pathname === "/api/listAgents") {
      if (arm && mode === "roster") {
        rosterPolls += 1;
        if (rosterPolls >= 4) running = false;
      }
      const agent = rosterRunningField
        ? {
            id: "sand-agent-e2e",
            name: "OpenBot",
            isRunning: running,
            isComposingMessage: composing,
            isRetrying: retryingFlag,
          }
        : { id: "sand-agent-e2e", name: "OpenBot" };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ agents: [agent] }));
      return;
    }
    if (url.pathname === "/api/sendPrompt") {
      assert.equal(request.headers.authorization, "Bearer gw-e2e");
      const parsed = JSON.parse(body);
      assert.equal(isDynamicRecord(parsed) && typeof parsed.prompt === "string" && parsed.prompt.length > 0, true);
      armTurn();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ accepted: true }));
      return;
    }
    if (url.pathname === "/api/getAgentTranscriptTail") {
      response.writeHead(200, { "content-type": "application/json" });
      if (!arm) {
        response.end(JSON.stringify({ entries: mode === "window" ? windowTail(false) : [] }));
        return;
      }
      polls += 1;
      if ((mode === "wait" || mode === "permission") && polls >= 4 && !released) {
        released = true;
        publishEnded();
      }
      response.end(JSON.stringify({ entries: liveEntries() }));
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

interface Note {
  method: string;
  params: unknown;
}

interface ToolRow {
  readonly id: unknown;
  readonly namespace: unknown;
  readonly tool: unknown;
  readonly status: unknown;
  readonly contentItems: unknown;
}

function toolRows(notes: readonly Note[], method: string): ToolRow[] {
  return notes.flatMap((note) => {
    if (note.method !== method || !isDynamicRecord(note.params) || !isDynamicRecord(note.params.item)) return [];
    const item = note.params.item;
    if (item.type !== "dynamicToolCall") return [];
    return [
      {
        id: item.id,
        namespace: item.namespace,
        tool: item.tool,
        status: item.status,
        contentItems: item.contentItems,
      },
    ];
  });
}

function assistantText(notes: readonly Note[]): string {
  return notes
    .filter((note) => note.method === "item/agentMessage/delta")
    .map((note) => (isDynamicRecord(note.params) && typeof note.params.delta === "string" ? note.params.delta : ""))
    .join("");
}

async function runTurn(
  client: GrokBotAgentClient,
  threadId: string,
  prompt: string,
  nextMode: Mode,
  limitMs = 4_000,
): Promise<Note[]> {
  configure(nextMode);
  const notes: Note[] = [];
  const onNote = (notification: Note) => notes.push(notification);
  client.on("notification", onNote);
  await Effect.runPromise(
    client.request(
      "turn/start",
      { threadId, model: "default", input: [{ type: "text", text: prompt }] },
      decodeTurnResponse,
    ),
  );
  await new Promise<void>((ready, reject) => {
    const timer = setTimeout(() => reject(new Error(`turn did not finish: ${prompt}`)), limitMs);
    const done = () => {
      const completed = notes.find((note) => note.method === "turn/completed");
      if (!completed || !isDynamicRecord(completed.params) || !isDynamicRecord(completed.params.turn)) return;
      clearTimeout(timer);
      client.off("notification", done);
      ready();
    };
    client.on("notification", done);
    done();
  });
  client.off("notification", onNote);
  return notes;
}

try {
  const store = new GrokBotAccountStore(authFile, cipher);
  await Effect.runPromise(
    store.save({
      accessToken: "grok-access-e2e",
      refreshToken: "grok-refresh-e2e",
      gateway: { url: `http://127.0.0.1:${addressPort}`, token: "gw-e2e", headers: {} },
    }),
  );
  const client = new GrokBotAgentClient({
    store,
    apiBaseUrl: `http://127.0.0.1:${addressPort}`,
    allowLoopback: true,
    gatewayPollMs: 20,
    gatewayQuietMs: 30_000,
    gatewayTurnTimeoutMs: 8_000,
  });
  const diagnostics: string[] = [];
  client.on("request", (request) => toolRequests.push(request.method));
  client.on("diagnostic", (line) => diagnostics.push(line));
  client.start();
  const started = await Effect.runPromise(
    client.request("thread/start", { developerInstructions: "Be brief." }, decodeThreadResponse),
  );
  assert.equal(started.thread.id, "sand-agent-e2e");

  const textNotes = await runTurn(client, started.thread.id, "text only", "text");
  report.textReply = assistantText(textNotes);
  assert.equal(report.textReply, REPLY);
  assert.equal(toolRows(textNotes, "item/completed").length, 0);
  const textTurn = textNotes.find((note) => note.method === "turn/completed");
  assert.equal(
    isDynamicRecord(textTurn?.params) && isDynamicRecord(textTurn.params.turn) && textTurn.params.turn.status,
    "completed",
  );
  const usage = textNotes.find((note) => note.method === "openbot/usage");
  const usageRecord = isDynamicRecord(usage?.params) ? usage.params.usage : undefined;
  report.usageInputTokens =
    isDynamicRecord(usageRecord) && typeof usageRecord.inputTokens === "number" ? usageRecord.inputTokens : 0;
  assert.equal(report.usageInputTokens, 11 + 3 + 1);
  assert.equal(isDynamicRecord(usageRecord) && usageRecord.outputTokens, 5);
  assert.equal(isDynamicRecord(usageRecord) && usageRecord.cachedReadTokens, 3);
  assert.equal(isDynamicRecord(usageRecord) && usageRecord.cachedWriteTokens, 1);

  const toolNotes = await runTurn(client, started.thread.id, "use the tool", "tool");
  const completedTools = toolRows(toolNotes, "item/completed");
  report.toolNames = completedTools.map((item) => (typeof item.tool === "string" ? item.tool : ""));
  report.toolStatuses = completedTools.map((item) => (typeof item.status === "string" ? item.status : ""));
  assert.deepEqual(report.toolNames, ["Shell", "Read"]);
  assert.deepEqual(report.toolStatuses, ["completed", "completed"]);
  assert.equal(
    completedTools.every((item) => item.namespace === "sand"),
    true,
  );
  assert.equal(
    completedTools.some((item) => item.id === "t0c"),
    false,
  );
  assert.equal(assistantText(toolNotes), TOOL_REPLY);
  const shell = completedTools.find((item) => item.id === "t2c0");
  const shellDetail = Array.isArray(shell?.contentItems) ? shell.contentItems[0] : undefined;
  assert.equal(isDynamicRecord(shellDetail) && shellDetail.text, "listed files");
  const startedTools = toolRows(toolNotes, "item/started");
  assert.deepEqual(
    startedTools.map((item) => item.id),
    ["t2c0", "t2c1"],
  );

  const waitNotes = await runTurn(client, started.thread.id, "wait for the tool", "wait");
  report.waitingHeld = released && assistantText(waitNotes) === WAIT_REPLY;
  assert.equal(report.waitingHeld, true);
  const waitTool = toolRows(waitNotes, "item/completed").find((item) => item.id === "t3c");
  assert.equal(waitTool?.status, "completed");
  const waitStatus = waitNotes.find((note) => note.method === "turn/completed");
  assert.equal(
    isDynamicRecord(waitStatus?.params) && isDynamicRecord(waitStatus.params.turn) && waitStatus.params.turn.status,
    "completed",
  );

  const failNotes = await runTurn(client, started.thread.id, "tool fails", "fail");
  const failedTool = toolRows(failNotes, "item/completed").find((item) => item.id === "t4c");
  report.failedToolStatus = typeof failedTool?.status === "string" ? failedTool.status : "";
  assert.equal(report.failedToolStatus, "failed");
  assert.equal(assistantText(failNotes), FAIL_REPLY);

  const permissionNotes = await runTurn(client, started.thread.id, "need permission", "permission");
  report.permissionHeld = released && assistantText(permissionNotes) === PERMISSION_REPLY;
  assert.equal(report.permissionHeld, true);
  assert.equal(toolRows(permissionNotes, "item/completed").length, 0);
  assert.equal(toolRows(permissionNotes, "item/started").length, 0);

  const interimStart = Date.now();
  const interimNotes = await runTurn(client, started.thread.id, "date on my computer", "interim", 4_000);
  const interimTool = toolRows(interimNotes, "item/completed").find((item) => item.id === "t6c");
  assert.equal(interimTool?.status, "completed");
  assert.equal(interimTool?.namespace, "sand");
  assert.equal(assistantText(interimNotes), `${INTERIM_REPLY}\n\n${FINAL_REPLY}`);
  report.writingShown = interimNotes.some(
    (note) =>
      note.method === "openbot/activity" &&
      isDynamicRecord(note.params) &&
      note.params.detail === sourceText("status.agent.grokBotWriting"),
  );
  assert.equal(report.writingShown, true);
  assert.ok(Date.now() - interimStart < 2_000, "interim turn waited on a quiet window");
  report.interimHeld = true;

  const retryStart = Date.now();
  const retryNotes = await runTurn(client, started.thread.id, "retry this", "retrying", 4_000);
  const retryElapsed = Date.now() - retryStart;
  report.retryingHeld =
    retryElapsed >= 400 &&
    assistantText(retryNotes) === "Retried reply" &&
    retryNotes.some(
      (note) =>
        note.method === "openbot/activity" &&
        isDynamicRecord(note.params) &&
        note.params.detail === sourceText("status.agent.grokBotRetrying"),
    );
  assert.equal(report.retryingHeld, true);

  const subStart = Date.now();
  const subNotes = await runTurn(client, started.thread.id, "subagent holds", "subagent", 4_000);
  report.subagentHeld = Date.now() - subStart >= 400 && assistantText(subNotes) === "Parent still running";
  assert.equal(report.subagentHeld, true);

  const windowNotes = await runTurn(client, started.thread.id, WINDOW_PROMPT, "window", 4_000);
  report.windowedTail = assistantText(windowNotes) === WINDOW_REPLY;
  assert.equal(report.windowedTail, true);
  const windowTurn = windowNotes.find((note) => note.method === "turn/completed");
  assert.equal(
    isDynamicRecord(windowTurn?.params) && isDynamicRecord(windowTurn.params.turn) && windowTurn.params.turn.status,
    "completed",
  );

  const rosterNotes = await runTurn(client, started.thread.id, "roster signal", "roster", 4_000);
  report.rosterEnded = assistantText(rosterNotes) === "Roster reply";
  assert.equal(report.rosterEnded, true);
  assert.equal(
    rosterNotes.some((note) => note.method === "turn/completed"),
    true,
  );

  const quiet = new GrokBotAgentClient({
    store,
    apiBaseUrl: `http://127.0.0.1:${addressPort}`,
    allowLoopback: true,
    gatewayPollMs: 20,
    gatewayQuietMs: 80,
    gatewayTurnTimeoutMs: 3_000,
  });
  const quietDiagnostics: string[] = [];
  quiet.on("diagnostic", (line) => quietDiagnostics.push(line));
  quiet.on("request", (request) => toolRequests.push(request.method));
  quiet.start();
  const quietThread = await Effect.runPromise(
    quiet.request("thread/start", { developerInstructions: "Be brief." }, decodeThreadResponse),
  );
  const quietNotes = await runTurn(quiet, quietThread.thread.id, "quiet fallback", "quiet", 4_000);
  report.quietFallback =
    assistantText(quietNotes) === "Quiet reply" && quietDiagnostics.some((line) => line.includes("quiet window"));
  assert.equal(report.quietFallback, true);
  assert.equal(
    diagnostics.some((line) => line.includes("quiet window")),
    false,
  );
  await Effect.runPromise(quiet.stop());

  const long = new GrokBotAgentClient({
    store,
    apiBaseUrl: `http://127.0.0.1:${addressPort}`,
    allowLoopback: true,
    gatewayPollMs: 50,
    gatewayQuietMs: 12_000,
    gatewayTurnTimeoutMs: 20_000,
  });
  long.on("request", (request) => toolRequests.push(request.method));
  long.start();
  const longThread = await Effect.runPromise(
    long.request("thread/start", { developerInstructions: "Be brief." }, decodeThreadResponse),
  );
  const longStart = Date.now();
  const longNotes = await runTurn(long, longThread.thread.id, "long tool", "long", 18_000);
  const longElapsed = Date.now() - longStart;
  const longTool = toolRows(longNotes, "item/completed").find((item) => item.id === "t7c");
  assert.equal(longTool?.status, "completed");
  assert.equal(assistantText(longNotes), "Working on a long tool.\n\nLong tool done.");
  assert.ok(longElapsed >= 12_500, `long tool ended early after ${longElapsed}ms`);
  assert.ok(longElapsed < 18_000, `long tool waited for the timeout after ${longElapsed}ms`);
  report.longToolHeld = true;
  await Effect.runPromise(long.stop());

  report.noToolCallRequest = !toolRequests.includes("item/tool/call");
  report.noDirectStream = streamCalls === 0;
  assert.equal(report.noToolCallRequest, true);
  assert.equal(report.noDirectStream, true);
  await Effect.runPromise(client.stop());
  report.passed = true;
} finally {
  clearTimers();
  for (const stream of eventStreams) stream.end();
  await new Promise<void>((ready, reject) => server.close((error) => (error ? reject(error) : ready())));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

if (!report.passed) process.exit(1);
