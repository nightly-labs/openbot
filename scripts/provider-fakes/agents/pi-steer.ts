import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { isDynamicRecord, type DynamicRecord as RpcRecord } from "@openbot/contracts/runtime-values";

const sessionFile = join(process.env.FAKE_DIR ?? process.cwd(), `pi-${process.pid}.jsonl`);
let streaming = false;
let queue: string[] = [];

function log(entry: RpcRecord): void {
  const path = process.env.FAKE_LOG;
  if (path) appendFileSync(path, `${JSON.stringify(entry)}\n`);
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

function settle(text: string): void {
  streaming = false;
  write({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" },
  });
  write({ type: "agent_settled" });
}

const handlers: Record<string, (command: RpcRecord) => void> = {
  get_state: (command) => answer(command, { sessionFile, isStreaming: streaming, isCompacting: false }),
  switch_session: (command) => answer(command, { cancelled: false }),
  get_session_stats: (command) => refuse(command, "No stats."),
  prompt: (command) => {
    log({ event: "prompt", text: String(command.message), streamingBehavior: String(command.streamingBehavior) });
    if (streaming) return refuse(command, "Agent is already processing.");
    streaming = true;
    answer(command, { disposition: "started" });
  },
  steer: (command) => {
    const text = String(command.message);
    log({ event: "steer", text, images: Array.isArray(command.images) ? command.images.length : 0 });
    if (text.startsWith("refuse")) return refuse(command, `Pi refused the steer: ${text}`);
    queue.push(text);
    if (text.startsWith("slow")) return;
    answer(command, { disposition: "queued" });
    if (text.startsWith("hold") || !streaming) return;
    setTimeout(() => {
      const read = queue.join(", ");
      queue = [];
      settle(`steered: ${read}`);
    }, 50);
  },
  clear_queue: (command) => {
    log({ event: "clear_queue", steering: queue.join(", ") });
    answer(command, { steering: queue, followUp: [] });
    queue = [];
  },
  abort: (command) => {
    log({ event: "abort" });
    answer(command);
  },
};

createInterface({ input: process.stdin }).on("line", (line) => {
  const command = line.trim() ? JSON.parse(line) : null;
  if (!isDynamicRecord(command)) return;
  const handler = handlers[String(command.type)];
  if (handler) handler(command);
  else refuse(command, `The fake Pi does not implement ${String(command.type)}.`);
});
