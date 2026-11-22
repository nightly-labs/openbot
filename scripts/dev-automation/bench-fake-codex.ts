import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type FakeCodexCorpus = "words" | "markdown";

export interface FakeCodexOptions {
  deltaMs: number;
  deltas: number;
  corpus?: FakeCodexCorpus;
  reasoning?: boolean;
  commands?: boolean;
}

export interface FakeCodex {
  environment: Record<string, string>;
  logPath: string;
}

const MARKDOWN_CORPUS = [
  "## Request flow",
  "",
  "The server reads each request, checks the session and sends `json` back. Each handler is small.",
  "",
  "1. Read the **config** file.",
  "2. Open the database.",
  "3. Start the listener.",
  "",
  "```ts",
  "export async function start(path: string): Promise<Server> {",
  "  const config = await readConfig(path);",
  "  return listen(config.port);",
  "}",
  "```",
  "",
  "| Route | Method | Result |",
  "| --- | --- | --- |",
  "| `/health` | GET | `200` |",
  "| `/agents` | GET | agent list |",
  "| `/agents/:id` | PATCH | updated agent |",
  "",
  "### Errors",
  "",
  "- A missing file gives `ENOENT`.",
  "- A bad port gives `EACCES`.",
  "  - Use a port above 1024.",
  "",
  "```rust",
  "fn main() {",
  '    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".into());',
  '    println!("listening on {port}");',
  "}",
  "```",
  "",
  "```sql",
  "SELECT id, name FROM agents WHERE archived_at IS NULL ORDER BY name;",
  "```",
  "",
  "```bash",
  "bun install --frozen-lockfile",
  "bun run build",
  "```",
  "",
  "### Data",
  "",
  "> The store keeps one row per message. A reply that streams writes the same row again.",
  "",
  "```json",
  '{ "agentId": "chief", "status": "streaming", "text": "" }',
  "```",
  "",
  "```python",
  "def handle(request):",
  '    return {"status": 200, "body": request.body}',
  "```",
  "",
  "```css",
  ".conversation { display: grid; gap: 8px; }",
  "```",
  "",
  "```go",
  "func Handle(w http.ResponseWriter, r *http.Request) {",
  "\tw.WriteHeader(http.StatusOK)",
  "}",
  "```",
  "",
  "Done. The next section repeats the same steps for the worker.",
  "",
  "",
].join("\n");

const MARKDOWN_PIECES = MARKDOWN_CORPUS.match(/\S+\s*|\s+/gu) ?? [];

const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = process.env.OPENBOT_BENCH_CODEX_LOG;
const DELTA_MS = Number(process.env.OPENBOT_BENCH_CODEX_DELTA_MS || "50");
const DELTAS = Number(process.env.OPENBOT_BENCH_CODEX_DELTAS || "400");
const MARKDOWN = process.env.OPENBOT_BENCH_CODEX_CORPUS === "markdown";
const REASONING = process.env.OPENBOT_BENCH_CODEX_REASONING === "1";
const COMMANDS = process.env.OPENBOT_BENCH_CODEX_COMMANDS === "1";
const REASONING_DELTAS = 40;
const COMMAND_COUNT = 5;
const COMMAND_OUTPUT_DELTAS = 4;
const MARKDOWN_PIECES = ${JSON.stringify(MARKDOWN_PIECES)};
const log = (entry) => fs.appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const WORDS = [
  "The ", "server ", "reads ", "each ", "request ", "and ", "sends ", "\`json\` ", "back. ", "\\n\\n",
  "- ", "First, ", "open ", "the ", "**config** ", "file.\\n", "- ", "Then ", "run ", "the ", "tests.\\n\\n",
  "\`\`\`ts\\n", "const ", "value ", "= ", "await ", "read(path);\\n", "\`\`\`\\n\\n",
];
const THOUGHTS = ["Reading ", "the ", "request ", "and ", "the ", "config. ", "Next ", "I ", "check ", "the ", "tests. "];
const nextDelta = (sent) => MARKDOWN
  ? MARKDOWN_PIECES[(sent * 2) % MARKDOWN_PIECES.length] + MARKDOWN_PIECES[(sent * 2 + 1) % MARKDOWN_PIECES.length]
  : WORDS[sent % WORDS.length] + WORDS[(sent * 7 + 3) % WORDS.length];
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
  log({
    turnEnded: turnId,
    threadId: turn.threadId,
    status,
    characters: turn.text.length,
    trimmedCharacters: turn.text.trim().length,
    deltas: turn.sent,
    reasoningDeltas: turn.reasoningDeltas,
    commandOutputDeltas: turn.commandOutputDeltas,
    at: Date.now(),
  });
};
const reasoningSteps = (threadId, turnId) => {
  const id = "reasoning-" + turnId;
  let summary = "";
  const steps = [() => write({ method: "item/started", params: { threadId, turnId, item: { type: "reasoning", id, summary: [], content: [] } } })];
  for (let index = 0; index < REASONING_DELTAS; index += 1) {
    steps.push((turn) => {
      const delta = THOUGHTS[index % THOUGHTS.length];
      summary += delta;
      turn.reasoningDeltas += 1;
      write({ method: "item/reasoning/summaryTextDelta", params: { threadId, turnId, itemId: id, delta, summaryIndex: 0 } });
    });
  }
  steps.push(() => write({ method: "item/completed", params: { threadId, turnId, item: { type: "reasoning", id, summary: [summary], content: [] } } }));
  return steps;
};
const commandSteps = (threadId, turnId) => {
  const steps = [];
  for (let index = 0; index < COMMAND_COUNT; index += 1) {
    const command = { type: "commandExecution", id: "command-" + turnId + "-" + index, command: "ls -la", cwd: "/tmp", status: "inProgress" };
    let output = "";
    steps.push(() => write({ method: "item/started", params: { threadId, turnId, item: command } }));
    for (let part = 0; part < COMMAND_OUTPUT_DELTAS; part += 1) {
      steps.push((turn) => {
        const delta = "-rw-r--r--  1 user  staff  " + (part + 1) * 512 + " file-" + part + ".txt\\n";
        output += delta;
        turn.commandOutputDeltas += 1;
        write({ method: "item/commandExecution/outputDelta", params: { threadId, turnId, itemId: command.id, delta } });
      });
    }
    steps.push(() => write({ method: "item/completed", params: { threadId, turnId, item: { ...command, status: "completed", aggregatedOutput: output, exitCode: 0 } } }));
  }
  return steps;
};
const stream = (threadId, turnId) => {
  const itemId = "message-" + turnId;
  const turn = { threadId, itemId, text: "", sent: 0, reasoningDeltas: 0, commandOutputDeltas: 0, timer: undefined };
  running.set(turnId, turn);
  const startMessage = () => write({ method: "item/started", params: { threadId, turnId, item: { type: "agentMessage", id: itemId, text: "", phase: "final_answer" } } });
  const steps = [...(REASONING ? reasoningSteps(threadId, turnId) : []), ...(COMMANDS ? commandSteps(threadId, turnId) : [])];
  if (steps.length > 0) steps.push(startMessage);
  else startMessage();
  log({ streamStarted: turnId, at: Date.now() });
  const thirds = [Math.floor(DELTAS / 3), Math.floor((DELTAS * 2) / 3)];
  turn.timer = setInterval(() => {
    const step = steps.shift();
    if (step) return step(turn);
    if (turn.sent >= DELTAS) return finish(turnId, "completed");
    const delta = nextDelta(turn.sent);
    turn.sent += 1;
    turn.text += delta;
    write({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId, delta } });
    const third = thirds.indexOf(turn.sent);
    if (third >= 0) log({ streamThird: third + 1, turnId, at: Date.now() });
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

export async function writeFakeCodex(directory: string, options: FakeCodexOptions): Promise<FakeCodex> {
  await rm(directory, { recursive: true, force: true });
  await mkdir(join(directory, "codex-home"), { recursive: true });
  const path = join(directory, "codex");
  const logPath = join(directory, "codex.jsonl");
  await writeFile(path, FAKE_CODEX);
  await writeFile(join(directory, "package.json"), '{ "type": "commonjs" }\n');
  await chmod(path, 0o755);
  await writeFile(logPath, "");
  return {
    logPath,
    environment: {
      OPENBOT_CODEX_PATH: path,
      CODEX_HOME: join(directory, "codex-home"),
      OPENBOT_BENCH_CODEX_LOG: logPath,
      OPENBOT_BENCH_CODEX_DELTA_MS: String(options.deltaMs),
      OPENBOT_BENCH_CODEX_DELTAS: String(options.deltas),
      OPENBOT_BENCH_CODEX_CORPUS: options.corpus ?? "words",
      OPENBOT_BENCH_CODEX_REASONING: options.reasoning ? "1" : "0",
      OPENBOT_BENCH_CODEX_COMMANDS: options.commands ? "1" : "0",
    },
  };
}
