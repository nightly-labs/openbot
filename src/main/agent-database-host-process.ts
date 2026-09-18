// How the packaged app starts the database host.
//
// It is an Electron `utilityProcess` rather than a child `node`: the app ships the
// `runAsNode: false` fuse, so `process.execPath` cannot be run as Node, and that fuse is part of the
// trust boundary -- it must not be relaxed to make a feature easier to build.
//
// `kill()` has to end a process that is wedged inside `sqlite3_step` and will never reach a signal
// handler. It can, because the host installs no signal listener of its own, so the default
// disposition applies and the kernel ends the process whatever it is doing.

import { join } from "node:path";
import { utilityProcess } from "electron";
import type { AgentDatabaseHostProcess, AgentDatabaseResponse } from "../backend/agent-data/agent-database-protocol";

export function spawnAgentDatabaseHost(): AgentDatabaseHostProcess {
  const child = utilityProcess.fork(join(__dirname, "agent-database-host.js"), [], {
    serviceName: "OpenBot databases",
    stdio: "ignore",
  });
  return {
    send: (request) => child.postMessage(request),
    onResponse: (listener) => {
      child.on("message", (message: AgentDatabaseResponse) => listener(message));
    },
    onExit: (listener) => {
      child.once("exit", () => listener());
    },
    kill: () => {
      child.kill();
    },
  };
}
