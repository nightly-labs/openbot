// Frozen optional browser-egress-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: a host that advertises the
// capability reads a data channel with the label `BROWSER_EGRESS_CHANNEL` from a desktop client.
// The client opens that channel only while its user shares the internet connection of that computer
// with the server, and closes it to stop. Through the channel the host asks the client to open TCP
// connections, and the two ends then relay the bytes. Only the host opens connections. The client
// refuses a target that is not a public internet address (no loopback, private, link-local,
// carrier-grade NAT, multicast or reserved address), resolves a name itself, and connects to the
// address that it checked. Any port is allowed. The channel is not part of the four channels that
// make a connection ready, and a lost egress channel never closes the connection.
//
// Frames: control is a JSON string, data is binary. Each end may send at most `credit` bytes of
// data for a stream before the other end gives more with a `credit` frame; the receiver gives it
// after it wrote the bytes to its socket, so one slow stream never stops the channel. A malformed
// frame closes the egress channel, not the connection.
import { isDynamicRecord, isNumber, isString } from "../runtime-values";

export const BROWSER_EGRESS_CAPABILITY = "browser-egress-v1";
export const BROWSER_EGRESS_CHANNEL = "openbot.browser-egress.v1";

/** The open streams of one channel. */
export const BROWSER_EGRESS_MAX_STREAMS = 256;
/** The bytes that each end may send for a stream before it gets credit. */
export const BROWSER_EGRESS_WINDOW_BYTES = 256 * 1024;
/** The data bytes in one binary frame. */
export const BROWSER_EGRESS_MAX_DATA_BYTES = 64 * 1024;

export type BrowserEgressRefusal = "address" | "lookup" | "connect" | "streams";

export type BrowserEgressControl =
  /** Host to client: open a TCP connection to `host` (a DNS name or an IP address) and `port`. */
  | { type: "open"; streamId: number; host: string; port: number }
  /** Client to host: the connection is open. */
  | { type: "opened"; streamId: number }
  /** Client to host: the connection did not open. */
  | { type: "refused"; streamId: number; reason: BrowserEgressRefusal }
  /** Either end: the other end may send `bytes` more data bytes for the stream. */
  | { type: "credit"; streamId: number; bytes: number }
  /** Either end: the stream is closed. No more frames for it follow. */
  | { type: "close"; streamId: number };

const REFUSALS: readonly BrowserEgressRefusal[] = ["address", "lookup", "connect", "streams"];
/** A DNS name, an IPv4 address, or an IPv6 address without brackets. */
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

/** Reads a control frame, or throws for a frame that is not one. */
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

/** A data frame: the stream ID as 4 bytes (big-endian), then the data. */
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
