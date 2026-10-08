import { Transform } from "node:stream";
import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { isRpcMessage, type RpcMessage } from "./protocol";

const MIB = 1024 * 1024;
const NEWLINE = 0x0a;

/**
 * The longest line that main holds for a provider CLI's stdout, in bytes.
 *
 * One JSON-RPC message is one line, and the largest is the full history of a thread: `thread/resume`
 * sends all turns in its response, with the base64 data of each generated image and tool screenshot.
 * The resume of a 125 MB Codex rollout was a 21 MB line, and one tool output in a rollout was 16 MB.
 * The limit allows larger thread histories. It also stops a CLI that writes with no
 * newline before main uses a large part of a 4 GB hosted server.
 */
const PROVIDER_LINE_LIMIT_BYTES = 256 * MIB;

/**
 * A provider CLI wrote a line longer than `PROVIDER_LINE_LIMIT_BYTES`. The stream cannot continue
 * after it: the rest of that line is not a message, and to parse it as one corrupts the stream.
 */
export class LineTooLongError extends Error {
  constructor(provider: string) {
    super(sourceText("error.provider.messageTooLarge", { provider, limit: PROVIDER_LINE_LIMIT_BYTES / MIB }));
    this.name = "LineTooLongError";
  }
}

/**
 * Passes a provider CLI's stdout on unchanged, and fails with `overflow()` when one line gets longer
 * than `limitBytes`. For a reader that holds lines itself, such as the ACP SDK's `ndJsonStream`.
 */
export function limitLineLength(overflow: () => Error, limitBytes = PROVIDER_LINE_LIMIT_BYTES): Transform {
  let lineBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const first = chunk.indexOf(NEWLINE);
      // `ended` is the line that stops at the first newline. A line between two newlines of one chunk
      // is shorter than the chunk, so it is not measured.
      const ended = first < 0 ? 0 : lineBytes + first;
      lineBytes = first < 0 ? lineBytes + chunk.length : chunk.length - chunk.lastIndexOf(NEWLINE) - 1;
      if (Math.max(ended, lineBytes) > limitBytes) callback(overflow());
      else callback(null, chunk);
    },
  });
}

export class JsonLineDecoder {
  readonly #limitBytes: number;
  /** The bytes of the line that is not complete. A newline byte never occurs inside a UTF-8 character. */
  #parts: Buffer[] = [];
  #held = 0;
  #overflowed = false;

  constructor(limitBytes = PROVIDER_LINE_LIMIT_BYTES) {
    this.#limitBytes = limitBytes;
  }

  push(chunk: Uint8Array | string): RpcMessage[] {
    if (this.#overflowed) throw new LineTooLongError("Codex");
    const bytes = isString(chunk)
      ? Buffer.from(chunk, "utf8")
      : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.length);
    const messages: RpcMessage[] = [];
    let start = 0;
    // Only the new chunk is searched for a newline, so a long line costs its length one time.
    for (let newline = bytes.indexOf(NEWLINE); newline >= 0; newline = bytes.indexOf(NEWLINE, start)) {
      const line = this.#takeLine(bytes.subarray(start, newline));
      start = newline + 1;
      if (line) messages.push(this.#parseLine(line));
    }
    // A copy, so the held tail does not keep the caller's whole chunk.
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

  /** Drops what is held and refuses all input after it: the stream has no next message to find. */
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
