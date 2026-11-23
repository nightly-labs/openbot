import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { isDynamicRecord, type DynamicRecord as RpcRecord } from "@openbot/contracts/runtime-values";

if (process.argv.includes("--version")) {
  process.stdout.write("1.6.0\n");
  process.exit(0);
}

let sessionFile = join(process.env.FAKE_DIR ?? process.cwd(), `pi-${process.pid}.jsonl`);
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };

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

function assistant(content: RpcRecord[], stopReason = "stop"): void {
  write({ type: "message_end", message: { role: "assistant", content, stopReason, usage } });
}

function toolStep(): void {
  const toolCallId = "call_read";
  const args = { path: "notes.txt" };
  write({ type: "tool_execution_start", toolCallId, toolName: "read", args });
  assistant([{ type: "toolCall", id: toolCallId, name: "read", arguments: args }], "toolUse");
  write({
    type: "tool_execution_end",
    toolCallId,
    toolName: "read",
    args,
    isError: false,
    result: { content: [{ type: "text", text: "Read." }] },
  });
}

function turn(text: string): void {
  if (text.includes("EMPTY-TURN")) assistant([]);
  else if (text.includes("REASONING-ONLY"))
    assistant([{ type: "thinking", thinking: "The user wants a short greeting." }]);
  else if (text.includes("STEP-THEN-EMPTY")) {
    toolStep();
    assistant([]);
  } else {
    write({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Done." },
    });
    assistant([{ type: "text", text: "Done." }]);
  }
  write({ type: "agent_settled" });
}

const handlers: Record<string, (command: RpcRecord) => void> = {
  get_state: (command) => answer(command, { sessionFile, isStreaming: false, isCompacting: false }),
  switch_session: (command) => {
    sessionFile = String(command.sessionPath);
    answer(command, { cancelled: false });
  },
  get_session_stats: (command) => answer(command, { tokens: { ...usage } }),
  prompt: (command) => {
    const text = String(command.message ?? "");
    log({ event: "prompt", text });
    answer(command, { disposition: "started" });
    turn(text);
  },
  abort: (command) => answer(command),
  clear_queue: (command) => answer(command, { steering: [], followUp: [] }),
  get_messages: (command) => answer(command, { messages: [] }),
  get_available_models: (command) =>
    answer(command, { models: [{ provider: "openrouter", id: "fake/empty", name: "Fake empty", reasoning: true }] }),
  set_model: (command) => answer(command, { provider: "openrouter", id: "fake/empty" }),
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
