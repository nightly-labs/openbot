// The Pi of `pi-long-instructions-e2e.ts`, on Pi's JSONL RPC (`pi --mode rpc`). At start it logs
// its own command line and how the developer instructions arrive: the `--append-system-prompt`
// value as a file (short line) or as the raw text (long line). A prompt answers at once with a
// fixed reply. Each request is logged to `FAKE_LOG`.
import { appendFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { isDynamicRecord, type DynamicRecord as RpcRecord } from "@openbot/contracts/runtime-values";

const sessionFile = join(process.env.FAKE_DIR ?? process.cwd(), `pi-${process.pid}.jsonl`);

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

const argv = process.argv.slice(2);
const index = argv.indexOf("--append-system-prompt");
const value = index >= 0 ? argv[index + 1] : null;
let promptIsFile = false;
let promptLength = 0;
if (value) {
  try {
    promptLength = statSync(value).size;
    promptIsFile = true;
  } catch {
    promptLength = Buffer.byteLength(value);
  }
}
log({ event: "argv", commandLine: argv.join(" "), promptIsFile, promptLength });

const handlers: Record<string, (command: RpcRecord) => void> = {
  get_state: (command) => answer(command, { sessionFile, isStreaming: false, isCompacting: false }),
  switch_session: (command) => answer(command, { cancelled: false }),
  prompt: (command) => {
    log({ event: "prompt", text: String(command.message) });
    answer(command, { disposition: "started" });
    write({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "long instructions ok" }], stopReason: "stop" },
    });
    write({ type: "agent_settled" });
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
