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

// The streams of one `browser-egress-v1` channel, on the host or on the client. A frame that breaks
// the protocol closes every stream and the channel, never the connection. Targets and bytes are
// user data: this module logs nothing.

export type BrowserEgressFrame = string | ArrayBuffer;

/** A site connection that the host asked for, before the client opened it. */
export interface BrowserEgressRequest {
  stream: BrowserEgressStream;
  host: string;
  port: number;
}

interface BrowserEgressMuxOptions {
  /** Sends one frame. The mux calls it in order and waits for each. */
  send: (frame: BrowserEgressFrame) => Promise<void>;
  /** Client only: the host asks for a site connection. Without it, an `open` frame breaks the protocol. */
  onRequest?: (request: BrowserEgressRequest) => void;
  /** The channel broke or a frame broke the protocol. The mux is closed. */
  onFailure: () => void;
}

/** One relayed TCP connection. It ends at once for each end: there is no half-close. */
export class BrowserEgressStream extends Duplex {
  readonly id: number;
  readonly #mux: BrowserEgressMux;
  /** The data bytes that this end may still send. */
  #credit = BROWSER_EGRESS_WINDOW_BYTES;
  /** The data bytes that the other end may still send. */
  #window = BROWSER_EGRESS_WINDOW_BYTES;
  /** Bytes that came in and are read, but for which the other end did not get credit yet. */
  #unacknowledged = 0;
  #creditWaiter: (() => void) | null = null;
  /** No `close` frame goes out: the other end closed it, or the channel is gone. */
  #silent = false;
  #closeSent = false;
  /** No more bytes are read: the readable side got its end. */
  #readEnded = false;

  constructor(id: number, mux: BrowserEgressMux) {
    super({ allowHalfOpen: false, readableHighWaterMark: BROWSER_EGRESS_MAX_DATA_BYTES });
    this.id = id;
    this.#mux = mux;
  }

  /** Client: the site connection is open. */
  opened(): Promise<void> {
    return this.#mux.sendControl({ type: "opened", streamId: this.id });
  }

  /** Client: the site connection did not open. The stream ends without a `close` frame. */
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
      // The other end closed the stream: what is left has nowhere to go.
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
    // The reader took the bytes, so the other end may send that many again.
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

  /** Data from the other end. False: it sent more than its credit. */
  receiveData(bytes: Uint8Array): boolean {
    if (bytes.byteLength > this.#window) return false;
    if (this.#silent || this.#readEnded) return true;
    this.#window -= bytes.byteLength;
    this.#unacknowledged += bytes.byteLength;
    this.push(Buffer.from(bytes));
    return true;
  }

  /** Credit from the other end. False: it gave more than one window. */
  receiveCredit(bytes: number): boolean {
    this.#credit += bytes;
    if (this.#credit > BROWSER_EGRESS_WINDOW_BYTES) return false;
    this.#wake();
    return true;
  }

  /** The other end closed the stream. Bytes that came before stay readable. */
  receiveClose(): void {
    this.#silent = true;
    this.#endRead();
    this.end();
    this.#wake();
  }

  /** The channel is gone. */
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

  /** Sends one frame after the frames before it. A failed send closes the mux. */
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

  /** Host: asks the client for a connection to a site. An abort closes the stream. */
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

  /** Reads one frame from the other end. A frame that breaks the protocol closes the mux. */
  receive(frame: BrowserEgressFrame): void {
    if (this.#closed) return;
    if (!this.#receive(frame)) this.#fail();
  }

  /** Closes every stream. No frame goes out. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) pending.reject(new BrowserEgressRefusedError("closed"));
    this.#pending.clear();
    for (const stream of [...this.#streams.values()]) stream.abandon();
    this.#streams.clear();
  }

  /** A stream that ended. Its id is not used again. */
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
      // Bytes for a stream that this end closed can still be on the way.
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
