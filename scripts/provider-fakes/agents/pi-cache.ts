import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { isDynamicRecord, type DynamicRecord as RpcRecord } from "@openbot/contracts/runtime-values";

if (process.argv.includes("--version")) {
  process.stdout.write("1.6.0\n");
  process.exit(0);
}

const LARGE_TOKENS = 611_000;
const COMPACTED_TOKENS = 19_400;
const CONTEXT_WINDOW = 1_000_000;
const CACHE_WRITE_TOKENS = 1_000;

let sessionFile = join(process.env.FAKE_DIR ?? process.cwd(), `pi-${process.pid}.jsonl`);
let contextTokens = LARGE_TOKENS;
const longCache = process.env.PI_CACHE_RETENTION === "long";

function log(entry: RpcRecord): void {
  const path = process.env.FAKE_LOG;
  if (path) appendFileSync(path, `${JSON.stringify({ ...entry, pid: process.pid })}\n`);
}

function write(record: RpcRecord): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function answer(command: RpcRecord, data: RpcRecord = {}): void {
  write({ type: "response", id: command.id, command: command.type, success: true, data });
}

function refuse(command: RpcRecord, error: string): void {
  write({ type: "response", id: command.id, command: command.type, success: false, error });
}

const handlers: Record<string, (command: RpcRecord) => void> = {
  get_state: (command) => answer(command, { sessionFile, isStreaming: false, isCompacting: false }),
  switch_session: (command) => {
    sessionFile = String(command.sessionPath);
    answer(command, { cancelled: false });
  },
  get_session_stats: (command) =>
    answer(command, {
      tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: CACHE_WRITE_TOKENS },
      contextUsage: { tokens: contextTokens, contextWindow: CONTEXT_WINDOW },
    }),
  prompt: (command) => {
    log({ event: "prompt", longCache });
    contextTokens = LARGE_TOKENS;
    answer(command, { disposition: "started" });
    write({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        stopReason: "stop",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: CACHE_WRITE_TOKENS,
          ...(longCache ? { cacheWrite1h: CACHE_WRITE_TOKENS } : {}),
        },
      },
    });
    write({ type: "agent_settled" });
  },
  compact: (command) => {
    log({ event: "compact", tokensBefore: contextTokens });
    const tokensBefore = contextTokens;
    contextTokens = COMPACTED_TOKENS;
    answer(command, { summary: "Summary.", firstKeptEntryId: "entry-1", tokensBefore });
  },
  abort: (command) => answer(command),
  clear_queue: (command) => answer(command, { steering: [], followUp: [] }),
  get_messages: (command) => answer(command, { messages: [] }),
  get_available_models: (command) =>
    answer(command, { models: [{ provider: "openrouter", id: "fake/cache", name: "Fake cache", reasoning: false }] }),
  set_model: (command) => answer(command, { provider: "openrouter", id: "fake/cache" }),
  set_thinking_level: (command) => answer(command),
};

let exited = false;
function exit(): void {
  if (exited) return;
  exited = true;
  process.exit(0);
}

process.on("SIGTERM", exit);
createInterface({ input: process.stdin })
  .on("line", (line) => {
    const command = line.trim() ? JSON.parse(line) : null;
    if (!isDynamicRecord(command)) return;
    const handler = handlers[String(command.type)];
    if (handler) handler(command);
    else refuse(command, `The fake Pi does not implement ${String(command.type)}.`);
  })
  .on("close", exit);
