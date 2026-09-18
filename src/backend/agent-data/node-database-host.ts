// Starts the database host as a plain `node` child over stdio.
//
// This is the transport the desktop tests use so they drive the real host -- the same file the
// packaged app runs -- rather than a stand-in. The packaged app cannot use it: it ships the
// `runAsNode: false` fuse, so it starts the same file as an Electron `utilityProcess` instead. See
// `src/main/agent-database-host-process.ts`.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { AgentDatabaseHostProcess, AgentDatabaseResponse } from "./agent-database-protocol";

export function spawnNodeDatabaseHost(): AgentDatabaseHostProcess {
  const child = spawn(process.execPath, [fileURLToPath(new URL("agent-database-host.ts", import.meta.url))], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  const lines = createInterface({ input: child.stdout });
  return {
    send: (request) => {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    },
    onResponse: (listener) => {
      lines.on("line", (line) => {
        if (line.trim().length === 0) return;
        try {
          const parsed = JSON.parse(line);
          if (isResponse(parsed)) listener(parsed);
        } catch {
          // A line that is not JSON is not addressed to us.
        }
      });
    },
    onExit: (listener) => {
      child.once("exit", () => listener());
    },
    kill: () => {
      // SIGKILL rather than SIGTERM: a host wedged inside `sqlite3_step` is exactly the case this
      // exists for, and there is nothing left in it worth letting finish.
      child.kill("SIGKILL");
    },
  };
}

/** Accepts a line as a response only when it carries the fields the supervisor reads. */
function isResponse(value: unknown): value is AgentDatabaseResponse {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || typeof value.id !== "number") return false;
  if (!("ok" in value) || typeof value.ok !== "boolean") return false;
  return value.ok ? "result" in value : "failure" in value;
}
