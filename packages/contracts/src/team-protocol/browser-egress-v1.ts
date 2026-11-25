import { isDynamicRecord, isNumber, isString } from "../runtime-values";

export const BROWSER_EGRESS_CAPABILITY = "browser-egress-v1";
export const BROWSER_EGRESS_CHANNEL = "openbot.browser-egress.v1";

export const BROWSER_EGRESS_MAX_STREAMS = 256;
export const BROWSER_EGRESS_WINDOW_BYTES = 256 * 1024;
export const BROWSER_EGRESS_MAX_DATA_BYTES = 64 * 1024;

export type BrowserEgressRefusal = "address" | "lookup" | "connect" | "streams";

export type BrowserEgressControl =
  | { type: "open"; streamId: number; host: string; port: number }
  | { type: "opened"; streamId: number }
  | { type: "refused"; streamId: number; reason: BrowserEgressRefusal }
  | { type: "credit"; streamId: number; bytes: number }
  | { type: "close"; streamId: number };

const REFUSALS: readonly BrowserEgressRefusal[] = ["address", "lookup", "connect", "streams"];
const TARGET_HOST =
  /^(?:[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,62})?(?:\.[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,62})?)*\.?|[0-9A-Fa-f:.]+)$/u;
const MAX_STREAM_ID = 0xffff_ffff;

function streamId(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 1 && value <= MAX_STREAM_ID;
}

export function isBrowserEgressTargetHost(value: unknown): value is string {
  return isString(value) && value.length >= 1 && value.length <= 253 && TARGET_HOST.test(value);
}

export function encodeBrowserEgressControl(message: BrowserEgressControl): string {
  return JSON.stringify(message);
}

export function decodeBrowserEgressControl(value: string): BrowserEgressControl {
  return decodeBrowserEgressControlValue(JSON.parse(value));
}

function decodeBrowserEgressControlValue(message: unknown): BrowserEgressControl {
  if (!isDynamicRecord(message) || !streamId(message.streamId)) throw new Error("Invalid browser egress frame.");
  const id = message.streamId;
  if (
    message.type === "open" &&
    isBrowserEgressTargetHost(message.host) &&
    isNumber(message.port) &&
    Number.isInteger(message.port) &&
    message.port >= 1 &&
    message.port <= 65_535
  )
    return { type: "open", streamId: id, host: message.host, port: message.port };
  if (message.type === "opened") return { type: "opened", streamId: id };
  if (message.type === "refused") {
    const reason = REFUSALS.find((refusal) => refusal === message.reason);
    if (reason) return { type: "refused", streamId: id, reason };
  }
  if (
    message.type === "credit" &&
    isNumber(message.bytes) &&
    Number.isInteger(message.bytes) &&
    message.bytes >= 1 &&
    message.bytes <= BROWSER_EGRESS_WINDOW_BYTES
  )
    return { type: "credit", streamId: id, bytes: message.bytes };
  if (message.type === "close") return { type: "close", streamId: id };
  throw new Error("Invalid browser egress frame.");
}

export function encodeBrowserEgressData(id: number, data: Uint8Array): ArrayBuffer {
  if (!streamId(id) || data.byteLength === 0 || data.byteLength > BROWSER_EGRESS_MAX_DATA_BYTES)
    throw new Error("Invalid browser egress data.");
  const frame = new Uint8Array(4 + data.byteLength);
  new DataView(frame.buffer).setUint32(0, id);
  frame.set(data, 4);
  return frame.buffer;
}

export function decodeBrowserEgressData(frame: ArrayBuffer): { streamId: number; bytes: Uint8Array } {
  if (frame.byteLength <= 4 || frame.byteLength > 4 + BROWSER_EGRESS_MAX_DATA_BYTES)
    throw new Error("Invalid browser egress data.");
  const id = new DataView(frame).getUint32(0);
  if (!streamId(id)) throw new Error("Invalid browser egress data.");
  return { streamId: id, bytes: new Uint8Array(frame, 4) };
}
