import type * as Ws from "ws";

export function rawDataSize(data: Ws.RawData): number {
  if (Array.isArray(data)) return data.reduce((total, chunk) => total + chunk.byteLength, 0);
  return data.byteLength;
}

export function rawDataBytes(data: Ws.RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return new Uint8Array(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
}

export function sendableCloseCode(code: number | undefined): number {
  if (code === undefined || code === 1005) return 1000;
  const valid =
    (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) || (code >= 3000 && code <= 4999);
  return valid ? code : 1011;
}

export function rawDataText(data: Ws.RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
}
