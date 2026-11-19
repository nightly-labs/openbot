// A Codex app-server for `dev:bench` scale scenarios. It streams a reply of fixed length at a fixed rate
// for each turn, so 100 agents can stream at once with no model quota, and each run sends the same
// text at the same rate. The app starts it through `OPENBOT_CODEX_PATH`, as it starts a real Codex.
//
// A process that OpenBot starts for a side turn with no tools, such as a channel summary, greets as
// "openbot-profile". It answers at once, and its turns are logged as side turns, not as member turns.
//
// It writes one JSON line for each ended turn, and one for each request it does not know, to the log
// that `OPENBOT_BENCH_CODEX_LOG` names. The bench reads that file to see when the turns ended, so the
// wait adds no work to the app it measures.
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface FakeCodexOptions {
  // The time between two pieces of streamed text of one turn.
  deltaMs: number;
  // The number of pieces in one reply.
  deltas: number;
}

export interface FakeCodex {
  environment: Record<string, string>;
  logPath: string;
}

const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = process.env.OPENBOT_BENCH_CODEX_LOG;
const DELTA_MS = Number(process.env.OPENBOT_BENCH_CODEX_DELTA_MS || "50");
const DELTAS = Number(process.env.OPENBOT_BENCH_CODEX_DELTAS || "400");
const log = (entry) => fs.appendFileSync(LOG, JSON.stringify(entry) + "\\n");
// Markdown of the kind a reply holds: prose, a list, inline code and a fenced block.
const WORDS = [
  "The ", "server ", "reads ", "each ", "request ", "and ", "sends ", "\`json\` ", "back. ", "\\n\\n",
  "- ", "First, ", "open ", "the ", "**config** ", "file.\\n", "- ", "Then ", "run ", "the ", "tests.\\n\\n",
  "\`\`\`ts\\n", "const ", "value ", "= ", "await ", "read(path);\\n", "\`\`\`\\n\\n",
];
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
const prefix = "p" + process.pid + "-";
let buffer = "";
let threads = 0;
let turns = 0;
let sideProcess = false;
const running = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (turnId, status) => {
  const turn = running.get(turnId);
  if (!turn) return;
  running.delete(turnId);
  clearInterval(turn.timer);
  const item = { type: "agentMessage", id: turn.itemId, text: turn.text, phase: "final_answer" };
  write({ method: "item/completed", params: { threadId: turn.threadId, turnId, item } });
  write({ method: "turn/completed", params: { threadId: turn.threadId, turn: { id: turnId, status } } });
  log({ turnEnded: turnId, threadId: turn.threadId, status, characters: turn.text.length });
};
const stream = (threadId, turnId) => {
  const itemId = "message-" + turnId;
  const turn = { threadId, itemId, text: "", sent: 0, timer: undefined };
  running.set(turnId, turn);
  write({ method: "item/started", params: { threadId, turnId, item: { type: "agentMessage", id: itemId, text: "", phase: "final_answer" } } });
  turn.timer = setInterval(() => {
    if (turn.sent >= DELTAS) return finish(turnId, "completed");
    const delta = WORDS[turn.sent % WORDS.length] + WORDS[(turn.sent * 7 + 3) % WORDS.length];
    turn.sent += 1;
    turn.text += delta;
    write({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId, delta } });
  }, DELTA_MS);
};
const answerSideTurn = (threadId, turnId) => {
  const item = { type: "agentMessage", id: "message-" + turnId, text: "A short summary.", phase: "final_answer" };
  write({ method: "item/started", params: { threadId, turnId, item: { ...item, text: "" } } });
  write({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: item.id, delta: item.text } });
  write({ method: "item/completed", params: { threadId, turnId, item } });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
  log({ sideTurnEnded: turnId });
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize":
      sideProcess = (params.clientInfo || {}).name === "openbot-profile";
      return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-5.5", displayName: "GPT-5.5", supportedReasoningEfforts: [{ reasoningEffort: "low" }], defaultReasoningEffort: "low" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: prefix + "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/name/set":
    case "thread/archive":
    case "thread/unarchive": return write({ id: message.id, result: {} });
    case "thread/backgroundTerminals/list":
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = prefix + "turn-" + (++turns);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      if (sideProcess) return answerSideTurn(params.threadId, turnId);
      return stream(params.threadId, turnId);
    }
    case "turn/interrupt": {
      if (!running.has(params.turnId)) return write({ id: message.id, error: { code: -32600, message: "No active turn." } });
      write({ id: message.id, result: {} });
      return finish(params.turnId, "interrupted");
    }
    default:
      log({ unknownMethod: message.method });
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  for (;;) {
    const newline = buffer.indexOf("\\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method && message.id !== undefined) answer(message);
  }
});
process.stdin.on("end", () => process.exit(0));
`;

/** Writes the fake Codex and an empty log into `directory`, which the bench owns. */
export async function writeFakeCodex(directory: string, options: FakeCodexOptions): Promise<FakeCodex> {
  await rm(directory, { recursive: true, force: true });
  await mkdir(join(directory, "codex-home"), { recursive: true });
  const path = join(directory, "codex");
  const logPath = join(directory, "codex.jsonl");
  await writeFile(path, FAKE_CODEX);
  // The folder is in the repository, whose `package.json` makes Node load a file with no extension
  // as an ES module. The fake uses `require`.
  await writeFile(join(directory, "package.json"), '{ "type": "commonjs" }\n');
  await chmod(path, 0o755);
  await writeFile(logPath, "");
  return {
    logPath,
    environment: {
      OPENBOT_CODEX_PATH: path,
      // The fake reads no Codex files, but the app can write Codex settings: keep them out of the
      // developer's own Codex home.
      CODEX_HOME: join(directory, "codex-home"),
      OPENBOT_BENCH_CODEX_LOG: logPath,
      OPENBOT_BENCH_CODEX_DELTA_MS: String(options.deltaMs),
      OPENBOT_BENCH_CODEX_DELTAS: String(options.deltas),
    },
  };
}
