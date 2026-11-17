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
import type { AgentDatabaseHostMessage, AgentDatabaseHostProcess } from "../backend/agent-data/agent-database-protocol";

/**
 * Enough for the error that stopped a start, such as a module that did not load. Below the 2,000
 * characters that the logger keeps of one value, with its "Its last output: " prefix.
 */
const OUTPUT_TAIL_CHARS = 1_900;

export function spawnAgentDatabaseHost(): AgentDatabaseHostProcess {
  const child = utilityProcess.fork(join(__dirname, "agent-database-host.js"), [], {
    serviceName: "OpenBot databases",
    // Only stderr, for the log when the host does not start (#10463).
    stdio: ["ignore", "ignore", "pipe"],
  });
  let output = "";
  // Always read: a full pipe would stop the host at its next write to stderr.
  child.stderr?.on("data", (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-OUTPUT_TAIL_CHARS);
  });
  return {
    send: (request) => child.postMessage(request),
    onMessage: (listener) => {
      child.on("message", (message: AgentDatabaseHostMessage) => listener(message));
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
