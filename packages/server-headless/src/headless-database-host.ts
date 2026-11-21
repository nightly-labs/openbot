// headless-database-host: replaces utilityProcess.fork of
// src/main/agent-database-host-process.ts:17 with a Bun child process running the REAL
// database host entry. The entry (src/backend/agent-data/agent-database-host.ts, the same
// file the packaged app bundles as agent-database-host.js) has a stdio fallback: without
// an Electron parentPort it speaks the frozen JSON-lines protocol from
// agent-database-protocol.ts over stdin/stdout — ready message first, one response per
// request line, graceful dispose when stdin closes. No Electron, no utilityProcess.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type {
  AgentDatabaseHostMessage,
  AgentDatabaseHostProcess,
} from "../../../src/backend/agent-data/agent-database-protocol";

const OUTPUT_TAIL_CHARS = 1_900;

export function spawnAgentDatabaseHostBun(): AgentDatabaseHostProcess {
  const entry = join(import.meta.dir, "..", "..", "..", "src", "backend", "agent-data", "agent-database-host.ts");
  const child = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "pipe"] });
  const messageListeners: Array<(message: AgentDatabaseHostMessage) => void> = [];
  let output = "";

  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line: string) => {
    if (line.trim().length === 0) return;
    try {
      const message = JSON.parse(line) as AgentDatabaseHostMessage;
      for (const listener of messageListeners) listener(message);
    } catch {
      output = `${output}${line}\n`.slice(-OUTPUT_TAIL_CHARS);
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-OUTPUT_TAIL_CHARS);
  });

  return {
    send: (request) => {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    },
    onMessage: (listener) => {
      messageListeners.push(listener);
    },
    onExit: (listener) => {
      child.once("exit", (code) => listener(code));
    },
    recentOutput: () => output.trim(),
    kill: () => {
      child.kill();
    },
  };
}
