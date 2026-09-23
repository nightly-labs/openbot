// The live view of a host browser tab, and the pointer and key input that goes back to it.
//
// A still image per request is what the released routes offer, and it is not a browser: the page
// moves, and a client that asks again gets the page as it was when it asked. This carries the
// screencast the host already produces, as JPEG frames on a socket, with input on the way back.
//
// The frames are binary because they are binary: base64 on the JSON channel costs a third more
// bytes for every frame and holds the same channel the client's requests use. The socket is opened
// through the tunnel the remote screen already uses, so nothing new is negotiated on the peer.
//
// Coordinates are a fraction of the frame, not pixels. The client draws a frame at whatever size
// its panel is, and the host's viewport is a third size again; sending pixels means one of the two
// has to know the other's scale, and the one that guesses wrong clicks somewhere else. A fraction
// means the same point in both.

import { INPUT_LIMITS } from "../input-limits";
import { isBoundedString, isIdentifier } from "../ipc-bounded-values";
import { isDynamicRecord, isNumber, isString } from "../runtime-values";

export const TEAM_BROWSER_VIEW_CAPABILITY = "browser-view";
/**
 * A host that expands a pointer fraction against the frame the point names, and that forgets a
 * frame once the client says a newer one is on screen. Older hosts reject an unknown input, so a
 * client sends the sequence and the drawn-frame acknowledgement only when the host advertises this.
 */
export const TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY = "browser-view-frame-point";
/** Present on the view socket when this client will acknowledge the frame it has drawn. */
export const BROWSER_VIEW_FRAME_ACK_QUERY = "frameAck";

export function browserViewClientAcksFrames(url: URL): boolean {
  return url.searchParams.get(BROWSER_VIEW_FRAME_ACK_QUERY) === "1";
}

/** A frame is one JPEG. The cap is generous for a photograph and refuses a stream that is not one. */
export const BROWSER_VIEW_MAX_FRAME_BYTES = 2 * 1024 * 1024;
const FRAME_MAGIC = new Uint8Array([0x4f, 0x42, 0x56, 0x31]);
const FRAME_HEADER_BYTES = FRAME_MAGIC.byteLength + 8;

export interface BrowserViewFrame {
  /** Counts from 1 on the host, so a client can see that it dropped one. */
  sequence: number;
  /** The frame's own pixels, which is what a fractional coordinate is a fraction of. */
  width: number;
  height: number;
  image: Uint8Array;
}

export interface BrowserViewSessionRequest {
  tabId: string;
}

export interface BrowserViewSessionResponse {
  id: string;
  tabId: string;
  /** Where the frames are. The host builds it, so the client never assembles a path of its own. */
  streamPath: string;
}

export type BrowserViewInput =
  | {
      type: "pointer";
      action: "move" | "down" | "up" | "wheel";
      x: number;
      y: number;
      /**
       * The frame the fraction is a fraction of. Sent only to a host that advertises
       * `browser-view-frame-point`. A client that omits it, including every client from before
       * this field, gets the newest frame the host sent.
       */
      sequence?: number;
      button: "left" | "middle" | "right";
      clickCount: number;
      deltaX: number;
      deltaY: number;
      modifiers: number;
    }
  | { type: "key"; action: "down" | "up" | "char"; key: string; code: string; text: string; modifiers: number }
  | { type: "ack"; sequence: number };

export function isBrowserViewSessionsRoute(method: string, path: string): boolean {
  return method === "POST" && pathname(path) === "/v1/browser/view/sessions";
}

export function isBrowserViewSessionRoute(method: string, path: string): boolean {
  return method === "DELETE" && /^\/v1\/browser\/view\/sessions\/[^/]+$/u.test(pathname(path));
}

/** The one path the host's tunnel opens a socket for, and the one the host's router answers. */
export function browserViewStreamPath(sessionId: string): string {
  if (!isIdentifier(sessionId)) throw new Error("Invalid browser view session ID.");
  return `/v1/browser/view/sessions/${sessionId}/stream`;
}

export function browserViewStreamSessionId(path: string): string | null {
  const match = /^\/v1\/browser\/view\/sessions\/([A-Za-z0-9_-]{1,64})\/stream$/u.exec(pathname(path));
  return match?.[1] ?? null;
}

export function decodeBrowserViewSessionRequest(value: unknown): BrowserViewSessionRequest {
  if (!isDynamicRecord(value) || !isIdentifier(value.tabId)) throw new Error("Invalid browser view request.");
  return { tabId: value.tabId };
}

export function decodeBrowserViewSessionResponse(value: unknown): BrowserViewSessionResponse {
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.id) ||
    !isIdentifier(value.tabId) ||
    !isBoundedString(value.streamPath, INPUT_LIMITS.browserUrl) ||
    browserViewStreamSessionId(value.streamPath) !== value.id
  ) {
    throw new Error("Invalid browser view response.");
  }
  return { id: value.id, tabId: value.tabId, streamPath: value.streamPath };
}

export function encodeBrowserViewFrame(frame: BrowserViewFrame): Uint8Array {
  if (frame.image.byteLength > BROWSER_VIEW_MAX_FRAME_BYTES) throw new Error("The browser view frame is too large.");
  const bytes = new Uint8Array(FRAME_HEADER_BYTES + frame.image.byteLength);
  const header = new DataView(bytes.buffer, 0, FRAME_HEADER_BYTES);
  bytes.set(FRAME_MAGIC, 0);
  header.setUint32(FRAME_MAGIC.byteLength, frame.sequence);
  header.setUint16(FRAME_MAGIC.byteLength + 4, dimension(frame.width));
  header.setUint16(FRAME_MAGIC.byteLength + 6, dimension(frame.height));
  bytes.set(frame.image, FRAME_HEADER_BYTES);
  return bytes;
}

export function decodeBrowserViewFrame(data: Uint8Array): BrowserViewFrame {
  if (
    data.byteLength <= FRAME_HEADER_BYTES ||
    data.byteLength > FRAME_HEADER_BYTES + BROWSER_VIEW_MAX_FRAME_BYTES ||
    !FRAME_MAGIC.every((byte, index) => data[index] === byte)
  ) {
    throw new Error("Invalid browser view frame.");
  }
  const header = new DataView(data.buffer, data.byteOffset, FRAME_HEADER_BYTES);
  const frame = {
    sequence: header.getUint32(FRAME_MAGIC.byteLength),
    width: header.getUint16(FRAME_MAGIC.byteLength + 4),
    height: header.getUint16(FRAME_MAGIC.byteLength + 6),
    image: data.slice(FRAME_HEADER_BYTES),
  };
  if (frame.sequence < 1 || frame.width < 1 || frame.height < 1) throw new Error("Invalid browser view frame.");
  return frame;
}

export function encodeBrowserViewInput(input: BrowserViewInput): string {
  return JSON.stringify(input);
}

/**
 * The input a host of this capability is sent. A host that does not name frames still accepts the
 * released payload, and it expands every point with its newest frame. An acknowledgement is not
 * part of that payload: an older host closes the view on an input it does not know.
 */
export function browserViewInputForHost(input: BrowserViewInput, namesFrames: boolean): BrowserViewInput | null {
  if (!namesFrames && input.type === "ack") return null;
  if (input.type !== "pointer" || input.sequence === undefined || namesFrames) return input;
  const { sequence: _sequence, ...released } = input;
  return released;
}

/**
 * The host decodes what a remote member sends. Every field is bounded here rather than where it is
 * dispatched, so a value that reaches CDP has already been read as the small thing it is meant to be.
 */
export function decodeBrowserViewInput(value: string): BrowserViewInput {
  return decodeBrowserViewInputValue(JSON.parse(value));
}

/** The same bounds for a value that never was text: what a renderer sends its own main process. */
export function decodeBrowserViewInputValue(message: unknown): BrowserViewInput {
  if (!isDynamicRecord(message)) throw new Error("Invalid browser view input.");
  // The client says which frame it has drawn. There is no page event in it.
  if (message.type === "ack") return { type: "ack", sequence: sequenceNumber(message.sequence) };
  const modifiers = isNumber(message.modifiers) ? message.modifiers : 0;
  if (!Number.isInteger(modifiers) || modifiers < 0 || modifiers > 15) throw new Error("Invalid browser view input.");
  if (message.type === "pointer") {
    const action = message.action;
    if (action !== "move" && action !== "down" && action !== "up" && action !== "wheel") {
      throw new Error("Invalid browser view input.");
    }
    const button = message.button;
    if (button !== "left" && button !== "middle" && button !== "right") throw new Error("Invalid browser view input.");
    const clickCount = isNumber(message.clickCount) ? message.clickCount : 1;
    if (!Number.isInteger(clickCount) || clickCount < 1 || clickCount > 3) {
      throw new Error("Invalid browser view input.");
    }
    return {
      type: "pointer",
      action,
      x: fraction(message.x),
      y: fraction(message.y),
      ...(message.sequence === undefined ? {} : { sequence: sequenceNumber(message.sequence) }),
      button,
      clickCount,
      deltaX: scrollDelta(message.deltaX),
      deltaY: scrollDelta(message.deltaY),
      modifiers,
    };
  }
  if (message.type === "key") {
    const action = message.action;
    if (action !== "down" && action !== "up" && action !== "char") throw new Error("Invalid browser view input.");
    const text = isString(message.text) ? message.text : "";
    if (!isString(message.key) || !isString(message.code) || message.key.length > 32 || message.code.length > 32) {
      throw new Error("Invalid browser view input.");
    }
    // One keystroke carries one character; a paste is not sent a key at a time.
    if (text.length > 8) throw new Error("Invalid browser view input.");
    return { type: "key", action, key: message.key, code: message.code, text, modifiers };
  }
  throw new Error("Invalid browser view input.");
}

function fraction(value: unknown): number {
  if (!isNumber(value) || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Invalid browser view input.");
  }
  return value;
}

function sequenceNumber(value: unknown): number {
  if (!isNumber(value) || !Number.isInteger(value) || value < 1 || value > 0xff_ff_ff_ff) {
    throw new Error("Invalid browser view input.");
  }
  return value;
}

function scrollDelta(value: unknown): number {
  if (value === undefined) return 0;
  if (!isNumber(value) || !Number.isFinite(value) || Math.abs(value) > INPUT_LIMITS.browserCoordinate) {
    throw new Error("Invalid browser view input.");
  }
  return value;
}

function dimension(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error("Invalid browser view frame.");
  return value;
}

function pathname(path: string): string {
  return new URL(path, "http://openbot.invalid").pathname;
}
