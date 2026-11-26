import { type ChildProcess, spawn } from "node:child_process";
import {
  isProcessLauncherRequest,
  type ProcessLauncherEvent,
  type ProcessLauncherRequest,
} from "./process-launcher-protocol";

type Send = (event: ProcessLauncherEvent) => void;

const children = new Map<number, ChildProcess>();

function errorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function start(request: Extract<ProcessLauncherRequest, { kind: "spawn" }>, send: Send): void {
  const { id } = request;
  let child: ChildProcess;
  try {
    child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: request.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    send({ kind: "error", id, message: errorMessage(error), code: errorCode(error), spawnFailed: true });
    return;
  }
  children.set(id, child);
  child.stdout?.on("data", (data: Buffer) => send({ kind: "stdout", id, data: new Uint8Array(data) }));
  child.stderr?.on("data", (data: Buffer) => send({ kind: "stderr", id, data: new Uint8Array(data) }));
  child.stdin?.on("error", () => {});
  child.stdout?.on("error", () => {});
  child.stderr?.on("error", () => {});
  child.on("error", (error) =>
    send({
      kind: "error",
      id,
      message: error.message,
      code: errorCode(error),
      spawnFailed: child.pid === undefined,
    }),
  );
  child.on("close", (code, signal) => {
    children.delete(id);
    send({ kind: "exit", id, code, signal });
  });
}

function accept(message: unknown, send: Send): void {
  if (!isProcessLauncherRequest(message)) return;
  switch (message.kind) {
    case "spawn":
      start(message, send);
      return;
    case "stdin":
      children.get(message.id)?.stdin?.write(message.data);
      return;
    case "stdin-end":
      children.get(message.id)?.stdin?.end();
      return;
    case "kill":
      children.get(message.id)?.kill(message.signal);
      return;
  }
}

interface ParentPort {
  on(event: "message", listener: (message: { data: unknown }) => void): void;
  postMessage(value: unknown): void;
  start(): void;
}

function isParentPort(value: unknown): value is ParentPort {
  return typeof value === "object" && value !== null && "postMessage" in value && "start" in value;
}

const parentPort: ParentPort | undefined = isParentPort(process.parentPort) ? process.parentPort : undefined;

if (parentPort) {
  const send: Send = (event) => parentPort.postMessage(event);
  parentPort.on("message", (message) => accept(message.data, send));
  parentPort.start();
  send({ kind: "ready" });
} else if (process.send) {
  const post = process.send.bind(process);
  const send: Send = (event) => post(event);
  process.on("message", (message: unknown) => accept(message, send));
  process.on("disconnect", () => process.exit(0));
  send({ kind: "ready" });
}
