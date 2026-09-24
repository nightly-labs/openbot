// The Electron main process runs the backend: the SQLite stores, the
// conversation runtime and every provider client. Chromium's CDP port cannot
// see its heap, so `dev:bench` reads it through the Node inspector that an
// unpackaged build opens with `--inspect=<port>` on 127.0.0.1. A packaged build
// ships the `enableNodeCliInspectArguments: false` fuse, so this never reaches
// a user's app.

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import WebSocket from "ws";

const BYTES_PER_MB = 1_024 * 1_024;

export interface MainHeap {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  arrayBuffersMb: number;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

async function inspectorWebSocketUrl(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`The Node inspector on :${port} answered ${response.status}.`);
  const targets = await response.json();
  if (!Array.isArray(targets)) throw new Error(`The Node inspector on :${port} answered without a target list.`);
  for (const target of targets) {
    if (isDynamicRecord(target) && isString(target.webSocketDebuggerUrl)) return target.webSocketDebuggerUrl;
  }
  throw new Error(`The Node inspector on :${port} has no debugger target.`);
}

type EventHandler = (params: DynamicRecord) => void;

export class InspectorClient {
  readonly #socket: WebSocket;
  readonly #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  readonly #handlers = new Map<string, EventHandler>();
  #nextId = 1;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on("message", (data) => this.#receive(String(data)));
    socket.on("close", () => {
      for (const pending of this.#pending.values()) pending.reject(new Error("The Node inspector closed."));
      this.#pending.clear();
    });
  }

  static async connect(port: number): Promise<InspectorClient> {
    const url = await inspectorWebSocketUrl(port);
    // Only loopback: the port came from our own allocation, and the URL from
    // the inspector behind it.
    if (!url.startsWith("ws://127.0.0.1:") && !url.startsWith("ws://localhost:")) {
      throw new Error("The Node inspector named a non-loopback debugger address.");
    }
    const socket = new WebSocket(url, { perMessageDeflate: false, maxPayload: 512 * BYTES_PER_MB });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    return new InspectorClient(socket);
  }

  #receive(raw: string): void {
    const message = JSON.parse(raw);
    if (!isDynamicRecord(message)) return;
    if (isNumber(message.id)) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (isDynamicRecord(message.error)) {
        pending.reject(new Error(isString(message.error.message) ? message.error.message : "Inspector error."));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (isString(message.method)) {
      const handler = this.#handlers.get(message.method);
      if (handler && isDynamicRecord(message.params)) handler(message.params);
    }
  }

  send(method: string, params: DynamicRecord = {}): Promise<unknown> {
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, handler: EventHandler): void {
    this.#handlers.set(method, handler);
  }

  off(method: string): void {
    this.#handlers.delete(method);
  }

  async readHeap(): Promise<MainHeap> {
    const result = await this.send("Runtime.evaluate", {
      expression: "JSON.stringify(process.memoryUsage())",
      returnByValue: true,
    });
    const value = isDynamicRecord(result) && isDynamicRecord(result.result) ? result.result.value : undefined;
    const usage = isString(value) ? JSON.parse(value) : undefined;
    if (!isDynamicRecord(usage)) throw new Error("The main process did not report process.memoryUsage().");
    const megabytes = (key: string): number => {
      const bytes = usage[key];
      return isNumber(bytes) ? round(bytes / BYTES_PER_MB) : 0;
    };
    return {
      rssMb: megabytes("rss"),
      heapUsedMb: megabytes("heapUsed"),
      heapTotalMb: megabytes("heapTotal"),
      externalMb: megabytes("external"),
      arrayBuffersMb: megabytes("arrayBuffers"),
    };
  }

  /**
   * Runs an expression in the main process and returns its JSON value. The
   * command-line API gives it `require`, so a scenario can reach Electron's
   * `BrowserWindow` the way a user's click would, without a debug hook in the
   * app.
   */
  async evaluate(expression: string): Promise<unknown> {
    const result = await this.send("Runtime.evaluate", {
      expression: `Promise.resolve(${expression}).then((value) => JSON.stringify(value ?? null))`,
      awaitPromise: true,
      includeCommandLineAPI: true,
      returnByValue: true,
    });
    if (isDynamicRecord(result) && isDynamicRecord(result.exceptionDetails)) {
      const exception = result.exceptionDetails.exception;
      const description = isDynamicRecord(exception) && isString(exception.description) ? exception.description : "";
      throw new Error(`Main-process evaluation failed: ${description || "unknown error"}`);
    }
    const value = isDynamicRecord(result) && isDynamicRecord(result.result) ? result.result.value : undefined;
    return isString(value) ? JSON.parse(value) : null;
  }

  async collectGarbage(): Promise<void> {
    await this.send("HeapProfiler.enable");
    await this.send("HeapProfiler.collectGarbage");
  }

  // The snapshot of the main heap holds conversation text and can hold
  // secrets, so it is written only under the build directory the caller named
  // and is never printed.
  async writeHeapSnapshot(outPath: string): Promise<void> {
    await mkdir(dirname(outPath), { recursive: true });
    const stream = createWriteStream(outPath, { mode: 0o600 });
    this.on("HeapProfiler.addHeapSnapshotChunk", (params) => {
      if (isString(params.chunk)) stream.write(params.chunk);
    });
    try {
      await this.send("HeapProfiler.enable");
      await this.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
    } finally {
      this.off("HeapProfiler.addHeapSnapshotChunk");
      await new Promise<void>((resolve, reject) =>
        stream.end((error?: Error | null) => (error ? reject(error) : resolve())),
      );
    }
  }

  close(): void {
    this.#socket.close();
  }
}
