import { join } from "node:path";
import { utilityProcess } from "electron";
import { type ClaudeHistoryHostProcess, decodeClaudeHistoryHostMessage } from "../backend/claude-history-host-protocol";

/** The existing Claude scanner gets its own process; the packaged runAsNode fuse stays disabled. */
export function spawnClaudeHistoryHost(): ClaudeHistoryHostProcess {
  const child = utilityProcess.fork(join(__dirname, "claude-history-host.js"), [], {
    serviceName: "OpenBot Claude history",
    stdio: "ignore",
  });
  return {
    send: (request) => child.postMessage(request),
    onMessage: (listener) => {
      child.on("message", (value: unknown) => {
        const message = decodeClaudeHistoryHostMessage(value);
        if (message) listener(message);
        else child.kill();
      });
    },
    onExit: (listener) => {
      child.once("exit", () => listener());
    },
    kill: () => {
      child.kill();
    },
  };
}
