import { Transform } from "node:stream";
import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { perfCount } from "./perf-probe-hooks";
import { isRpcMessage, type RpcMessage } from "./protocol";

const MIB = 1024 * 1024;
const NEWLINE = 0x0a;

const PROVIDER_LINE_LIMIT_BYTES = 256 * MIB;

export class LineTooLongError extends Error {
  constructor(provider: string) {
    super(sourceText("error.provider.messageTooLarge", { provider, limit: PROVIDER_LINE_LIMIT_BYTES / MIB }));
    this.name = "LineTooLongError";
  }
}

export function limitLineLength(overflow: () => Error, limitBytes = PROVIDER_LINE_LIMIT_BYTES): Transform {
  let lineBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const first = chunk.indexOf(NEWLINE);
      const ended = first < 0 ? 0 : lineBytes + first;
      lineBytes = first < 0 ? lineBytes + chunk.length : chunk.length - chunk.lastIndexOf(NEWLINE) - 1;
      if (Math.max(ended, lineBytes) > limitBytes) callback(overflow());
      else callback(null, chunk);
    },
  });
}

export class JsonLineDecoder {
  readonly #limitBytes: number;
  #parts: Buffer[] = [];
  #held = 0;
  #overflowed = false;

  constructor(limitBytes = PROVIDER_LINE_LIMIT_BYTES) {
    this.#limitBytes = limitBytes;
  }

  push(chunk: Uint8Array | string): RpcMessage[] {
    if (this.#overflowed) throw new LineTooLongError("Codex");
    perfCount("jsonl.chunks");
    const bytes = isString(chunk)
      ? Buffer.from(chunk, "utf8")
      : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.length);
    const messages: RpcMessage[] = [];
    let start = 0;
    for (let newline = bytes.indexOf(NEWLINE); newline >= 0; newline = bytes.indexOf(NEWLINE, start)) {
      const line = this.#takeLine(bytes.subarray(start, newline));
      start = newline + 1;
      if (line) messages.push(this.#parseLine(line));
    }
    if (start < bytes.length) this.#hold(Buffer.from(bytes.subarray(start)));
    return messages;
  }

  end(chunk?: Uint8Array | string): RpcMessage[] {
    const messages = chunk ? this.push(chunk) : [];
    const trailing = this.#takeLine(Buffer.alloc(0));
    if (trailing) messages.push(this.#parseLine(trailing));
    return messages;
  }

  #hold(part: Buffer): void {
    this.#held += part.length;
    if (this.#held > this.#limitBytes) this.#overflow();
    this.#parts.push(part);
  }

  #takeLine(tail: Buffer): string {
    if (this.#held + tail.length > this.#limitBytes) this.#overflow();
    const bytes = this.#parts.length ? Buffer.concat([...this.#parts, tail]) : tail;
    this.#parts = [];
    this.#held = 0;
    return bytes.toString("utf8").trim();
  }

  #overflow(): never {
    this.#parts = [];
    this.#held = 0;
    this.#overflowed = true;
    throw new LineTooLongError("Codex");
  }

  #parseLine(line: string): RpcMessage {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSONL from Codex App Server: ${String(error)}`);
    }

    if (!isRpcMessage(parsed)) {
      throw new Error("Invalid JSON-RPC message from Codex App Server.");
    }

    return parsed;
  }
}
