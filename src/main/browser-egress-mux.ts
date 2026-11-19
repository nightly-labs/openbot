import { Duplex } from "node:stream";
import {
  BROWSER_EGRESS_MAX_DATA_BYTES,
  BROWSER_EGRESS_MAX_STREAMS,
  BROWSER_EGRESS_WINDOW_BYTES,
  type BrowserEgressControl,
  type BrowserEgressRefusal,
  decodeBrowserEgressControl,
  decodeBrowserEgressData,
  encodeBrowserEgressControl,
  encodeBrowserEgressData,
} from "@openbot/contracts/team-protocol/browser-egress-v1";

export type BrowserEgressFrame = string | ArrayBuffer;

export interface BrowserEgressRequest {
  stream: BrowserEgressStream;
  host: string;
  port: number;
}

interface BrowserEgressMuxOptions {
  send: (frame: BrowserEgressFrame) => Promise<void>;
  onRequest?: (request: BrowserEgressRequest) => void;
  onFailure: () => void;
}

export class BrowserEgressStream extends Duplex {
  readonly id: number;
  readonly #mux: BrowserEgressMux;
  #credit = BROWSER_EGRESS_WINDOW_BYTES;
  #window = BROWSER_EGRESS_WINDOW_BYTES;
  #unacknowledged = 0;
  #creditWaiter: (() => void) | null = null;
  #silent = false;
  #closeSent = false;
  #readEnded = false;

  constructor(id: number, mux: BrowserEgressMux) {
    super({ allowHalfOpen: false, readableHighWaterMark: BROWSER_EGRESS_MAX_DATA_BYTES });
    this.id = id;
    this.#mux = mux;
  }

  opened(): Promise<void> {
    return this.#mux.sendControl({ type: "opened", streamId: this.id });
  }

  refuse(reason: BrowserEgressRefusal): void {
    if (this.destroyed) return;
    this.#silent = true;
    void this.#mux.sendControl({ type: "refused", streamId: this.id, reason }).catch(() => undefined);
    this.destroy();
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.#writeData(chunk).then(() => callback(), callback);
  }

  async #writeData(chunk: Buffer): Promise<void> {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.#silent || this.destroyed) return;
      if (this.#credit === 0) {
        await new Promise<void>((resolve) => {
          this.#creditWaiter = resolve;
        });
        continue;
      }
      const size = Math.min(chunk.length - offset, this.#credit, BROWSER_EGRESS_MAX_DATA_BYTES);
      this.#credit -= size;
      await this.#mux.send(encodeBrowserEgressData(this.id, chunk.subarray(offset, offset + size)));
      offset += size;
    }
  }

  override _read(): void {
    if (this.#unacknowledged === 0 || this.#silent) return;
    const bytes = this.#unacknowledged;
    this.#unacknowledged = 0;
    this.#window += bytes;
    void this.#mux.sendControl({ type: "credit", streamId: this.id, bytes }).catch(() => undefined);
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.#sendClose();
    this.#endRead();
    callback();
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.#sendClose();
    this.#mux.forget(this);
    this.#wake();
    callback(error);
  }

  receiveData(bytes: Uint8Array): boolean {
    if (bytes.byteLength > this.#window) return false;
    if (this.#silent || this.#readEnded) return true;
    this.#window -= bytes.byteLength;
    this.#unacknowledged += bytes.byteLength;
    this.push(Buffer.from(bytes));
    return true;
  }

  receiveCredit(bytes: number): boolean {
    this.#credit += bytes;
    if (this.#credit > BROWSER_EGRESS_WINDOW_BYTES) return false;
    this.#wake();
    return true;
  }

  receiveClose(): void {
    this.#silent = true;
    this.#endRead();
    this.end();
    this.#wake();
  }

  abandon(): void {
    this.#silent = true;
    this.destroy();
  }

  #endRead(): void {
    if (this.#readEnded) return;
    this.#readEnded = true;
    this.push(null);
  }

  #sendClose(): void {
    if (this.#silent || this.#closeSent) return;
    this.#closeSent = true;
    void this.#mux.sendControl({ type: "close", streamId: this.id }).catch(() => undefined);
  }

  #wake(): void {
    const waiter = this.#creditWaiter;
    this.#creditWaiter = null;
    waiter?.();
  }
}

interface PendingOpen {
  resolve: () => void;
  reject: (error: Error) => void;
}

export class BrowserEgressRefusedError extends Error {
  readonly reason: BrowserEgressRefusal | "closed";

  constructor(reason: BrowserEgressRefusal | "closed") {
    super("The computer did not open the connection.");
    this.reason = reason;
  }
}

export class BrowserEgressMux {
  readonly #options: BrowserEgressMuxOptions;
  readonly #streams = new Map<number, BrowserEgressStream>();
  readonly #pending = new Map<number, PendingOpen>();
  #sending: Promise<void> = Promise.resolve();
  #nextStreamId = 1;
  #closed = false;

  constructor(options: BrowserEgressMuxOptions) {
    this.#options = options;
  }

  get closed(): boolean {
    return this.#closed;
  }

  send(frame: BrowserEgressFrame): Promise<void> {
    const sent = this.#sending.then(() => {
      if (this.#closed) throw new BrowserEgressRefusedError("closed");
      return this.#options.send(frame);
    });
    this.#sending = sent.catch(() => undefined);
    sent.catch(() => this.#fail());
    return sent;
  }

  sendControl(message: BrowserEgressControl): Promise<void> {
    return this.send(encodeBrowserEgressControl(message));
  }

  open(host: string, port: number, signal: AbortSignal): Promise<BrowserEgressStream> {
    if (this.#closed) return Promise.reject(new BrowserEgressRefusedError("closed"));
    if (this.#streams.size >= BROWSER_EGRESS_MAX_STREAMS)
      return Promise.reject(new BrowserEgressRefusedError("streams"));
    const stream = new BrowserEgressStream(this.#nextStreamId++, this);
    this.#streams.set(stream.id, stream);
    return new Promise<BrowserEgressStream>((resolve, reject) => {
      const abort = () => {
        this.#pending.delete(stream.id);
        stream.destroy();
        reject(new BrowserEgressRefusedError("closed"));
      };
      signal.addEventListener("abort", abort, { once: true });
      this.#pending.set(stream.id, {
        resolve: () => {
          signal.removeEventListener("abort", abort);
          resolve(stream);
        },
        reject: (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      });
      if (signal.aborted) return abort();
      this.sendControl({ type: "open", streamId: stream.id, host, port }).catch(() => undefined);
    });
  }

  receive(frame: BrowserEgressFrame): void {
    if (this.#closed) return;
    if (!this.#receive(frame)) this.#fail();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) pending.reject(new BrowserEgressRefusedError("closed"));
    this.#pending.clear();
    for (const stream of [...this.#streams.values()]) stream.abandon();
    this.#streams.clear();
  }

  forget(stream: BrowserEgressStream): void {
    if (this.#streams.get(stream.id) === stream) this.#streams.delete(stream.id);
    const pending = this.#pending.get(stream.id);
    this.#pending.delete(stream.id);
    pending?.reject(new BrowserEgressRefusedError("closed"));
  }

  #receive(frame: BrowserEgressFrame): boolean {
    if (frame instanceof ArrayBuffer) {
      let data: { streamId: number; bytes: Uint8Array };
      try {
        data = decodeBrowserEgressData(frame);
      } catch {
        return false;
      }
      return this.#streams.get(data.streamId)?.receiveData(data.bytes) ?? true;
    }
    let message: BrowserEgressControl;
    try {
      message = decodeBrowserEgressControl(frame);
    } catch {
      return false;
    }
    const stream = this.#streams.get(message.streamId);
    switch (message.type) {
      case "open": {
        if (!this.#options.onRequest || this.#streams.has(message.streamId)) return false;
        const request = new BrowserEgressStream(message.streamId, this);
        if (this.#streams.size >= BROWSER_EGRESS_MAX_STREAMS) {
          request.refuse("streams");
          return true;
        }
        this.#streams.set(request.id, request);
        this.#options.onRequest({ stream: request, host: message.host, port: message.port });
        return true;
      }
      case "opened": {
        if (this.#options.onRequest) return false;
        const pending = this.#pending.get(message.streamId);
        this.#pending.delete(message.streamId);
        pending?.resolve();
        return true;
      }
      case "refused": {
        if (this.#options.onRequest) return false;
        const pending = this.#pending.get(message.streamId);
        this.#pending.delete(message.streamId);
        pending?.reject(new BrowserEgressRefusedError(message.reason));
        stream?.abandon();
        return true;
      }
      case "credit":
        return stream?.receiveCredit(message.bytes) ?? true;
      case "close": {
        const pending = this.#pending.get(message.streamId);
        this.#pending.delete(message.streamId);
        pending?.reject(new BrowserEgressRefusedError("closed"));
        stream?.receiveClose();
        return true;
      }
    }
  }

  #fail(): void {
    if (this.#closed) return;
    this.close();
    this.#options.onFailure();
  }
}
