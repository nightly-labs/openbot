// The Pi of `pi-idle-release-e2e.ts`, on Pi's JSONL RPC (`pi --mode rpc`). A prompt settles at once.
// `switch_session` changes the session file that `get_state` reports, as a resumed Pi does. Each
// process logs its start, the sessions it switches to, its prompts and its exit to `FAKE_LOG`.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { isDynamicRecord, type DynamicRecord as RpcRecord } from "@openbot/contracts/runtime-values";

let sessionFile = join(process.env.FAKE_DIR ?? process.cwd(), `pi-${process.pid}.jsonl`);

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
    log({ event: "switch_session", sessionFile });
    answer(command, { cancelled: false });
  },
  get_session_stats: (command) => refuse(command, "No stats."),
  prompt: (command) => {
    log({ event: "prompt", sessionFile });
    answer(command, { disposition: "started" });
    write({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" },
    });
    write({ type: "agent_settled" });
  },
  abort: (command) => answer(command),
};

let exited = false;
function exit(reason: string): void {
  if (exited) return;
  exited = true;
  log({ event: "exit", reason, sessionFile });
  process.exit(0);
}

log({ event: "start" });
process.on("SIGTERM", () => exit("SIGTERM"));
createInterface({ input: process.stdin })
  .on("line", (line) => {
    const command = line.trim() ? JSON.parse(line) : null;
    if (!isDynamicRecord(command)) return;
    const handler = handlers[String(command.type)];
    if (handler) handler(command);
    else refuse(command, `The fake Pi does not implement ${String(command.type)}.`);
  })
  .on("close", () => exit("stdin"));
