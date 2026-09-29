// A `ws` message arrives as one buffer, an array of fragments, or an `ArrayBuffer`. These read all
// three the same way.

import type * as Ws from "ws";

export function rawDataSize(data: Ws.RawData): number {
  if (Array.isArray(data)) return data.reduce((total, chunk) => total + chunk.byteLength, 0);
  return data.byteLength;
}

/** A copy of the message bytes. It does not share memory with the `ws` buffer pool. */
export function rawDataBytes(data: Ws.RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return new Uint8Array(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
}

/**
 * A close code that `ws` accepts in `close()`. A received code can be one that no endpoint may send,
 * such as 1005 (no status) or 1006 (abnormal closure), and `close()` throws for it.
 */
export function sendableCloseCode(code: number | undefined): number {
  if (code === undefined) return 1000;
  const valid =
    (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) || (code >= 3000 && code <= 4999);
  return valid ? code : 1000;
}

export function rawDataText(data: Ws.RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
}
