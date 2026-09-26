import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";

/** The messages this client sends: two requests, and a refusal for each request the server makes. */
type AcpMessage =
  | { id: number; method: "initialize" | "authenticate"; params: DynamicRecord }
  | { id: unknown; error: { code: number; message: string } };

/**
 * A sign-in that is an ACP `authenticate` call, for a server that has no login command.
 *
 * The call runs in a process of its own, not in the client that serves turns: the server opens the
 * browser and waits there until the user finishes, and a status probe must never wait on that. The
 * server keeps what it signed in with, so the next process it starts is signed in already.
 *
 * `done` settles when the call answers, and the process is stopped then. It rejects when the call
 * fails, the process ends first, or `timeoutMs` passes.
 */
export function startAcpAuthentication(options: {
  executable: string;
  argv: readonly string[];
  env: Record<string, string>;
  methodId: string;
  timeoutMs: number;
}): { child: ChildProcess; done: Promise<void> } {
  const child = spawn(options.executable, [...options.argv], {
    cwd: process.cwd(),
    env: { ...process.env, ...options.env },
    // The server prints the sign-in URL on stderr. It opens the browser itself, so nothing reads it.
    stdio: ["pipe", "pipe", "ignore"],
    shell: false,
    windowsHide: process.platform === "win32",
  });
  const done = new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      if (child.exitCode === null) child.kill("SIGTERM");
      if (error) reject(error);
      else resolve();
    };
    const fail = (error: Error) => settle(error);
    const timer = setTimeout(() => fail(new Error(sourceText("error.provider.acpSignInTimedOut"))), options.timeoutMs);
    timer.unref?.();
    const send = (message: AcpMessage) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    child.once("error", fail);
    child.once("exit", () => fail(new Error(sourceText("error.provider.acpSignInStopped"))));
    child.stdin.on("error", () => undefined);
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (!isDynamicRecord(message)) return;
      // A request from the server gets a refusal, so it does not wait on a client that has no answer.
      if (typeof message.method === "string" && message.id !== undefined) {
        send({ id: message.id, error: { code: -32601, message: "Method not found" } });
        return;
      }
      if (message.error !== undefined && (message.id === 1 || message.id === 2)) {
        fail(new Error(sourceText("error.provider.acpSignInFailed")));
      } else if (message.id === 1) {
        send({ id: 2, method: "authenticate", params: { methodId: options.methodId } });
      } else if (message.id === 2) {
        settle(null);
      }
    });
    send({
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "openbot", title: "OpenBot", version: "0.1.0" },
      },
    });
  });
  return { child, done };
}
