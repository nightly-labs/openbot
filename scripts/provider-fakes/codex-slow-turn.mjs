#!/usr/bin/env node
// Fake Codex app-server for `scripts/reaction-during-turn-e2e.ts`: start the dev app with
// `OPENBOT_CODEX_PATH` set to this file. It lists only the model `fake-slow-turn`.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const releasePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.openbot-build/reaction-during-turn-e2e/release",
);

if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\n");
  process.exit(0);
}

let threads = 0;
let turns = 0;
let buffer = "";
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const step = (ms) => new Promise((done) => setTimeout(done, ms));
const answer = (id, result) => write({ id, result });

async function runTurn(threadId, turnId, request) {
  const itemId = `message-${turnId}`;
  const item = (method, body) =>
    write({ method, params: { threadId, turnId, item: { type: "agentMessage", id: itemId, ...body } } });
  let text = "";
  const delta = (part) => {
    text += part;
    write({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId, delta: part } });
  };
  item("item/started", { text: "" });
  if (!request.includes("Keep working")) delta(`Reply to: ${request}`);
  else {
    delta("Working");
    while (!existsSync(releasePath)) {
      await step(50);
      delta(".");
    }
  }
  item("item/completed", { text, phase: "final_answer" });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
}

function handle(message) {
  const params = message.params ?? {};
  switch (message.method) {
    case "account/read":
      return answer(message.id, { account: { type: "chatgpt", email: "codex@example.com" } });
    case "account/rateLimits/read":
      return answer(message.id, {
        rateLimits: { limitId: "codex", primary: null, secondary: null },
        rateLimitsByLimitId: null,
      });
    case "model/list":
      return answer(message.id, { data: [{ model: "fake-slow-turn", displayName: "Fake slow turn" }] });
    case "plugin/list":
      return answer(message.id, { marketplaces: [] });
    case "config/read":
      return answer(message.id, { config: { mcp_servers: {} }, layers: [] });
    case "thread/start":
      threads += 1;
      return answer(message.id, { thread: { id: `thread-${process.pid}-${threads}`, turns: [] } });
    case "thread/resume":
    case "thread/read":
      return answer(message.id, { thread: { id: params.threadId, turns: [] } });
    case "thread/unsubscribe":
      return answer(message.id, { status: "Unsubscribed" });
    case "thread/turns/list":
    case "thread/items/list":
      return answer(message.id, { data: [], nextCursor: null });
    case "initialize":
    case "config/batchWrite":
    case "thread/archive":
      return answer(message.id, {});
    case "turn/start": {
      turns += 1;
      const turnId = `turn-${process.pid}-${turns}`;
      answer(message.id, { turn: { id: turnId, status: "inProgress", items: [] } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const request = Array.isArray(params.input) ? params.input.at(-1)?.text : undefined;
      void runTurn(params.threadId, turnId, typeof request === "string" ? request : "");
      return;
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method && message.id !== undefined) handle(message);
  }
});
process.stdin.on("end", () => process.exit(0));
