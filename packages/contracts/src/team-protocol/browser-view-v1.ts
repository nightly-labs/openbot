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
/**
 * A host that pastes the client's text into the page and sends the page's selection back on copy.
 * The clipboard is the user's, on the client: the host never reads or writes its own. Older hosts
 * reject an unknown input, so a client sends `paste`, `copy` and `cut` only when the host advertises
 * this.
 */
export const TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY = "browser-view-clipboard";
/** Present on the view socket when this client will acknowledge the frame it has drawn. */
export const BROWSER_VIEW_FRAME_ACK_QUERY = "frameAck";

export function browserViewClientAcksFrames(url: URL): boolean {
  return url.searchParams.get(BROWSER_VIEW_FRAME_ACK_QUERY) === "1";
}

/**
 * A host that tells a client which mouse cursor the page shows, as a `cursor` message on the view
 * socket. A frame is a screenshot of the page and has no pointer in it. A client that draws the
 * pointer itself, such as a phone, needs the shape: a hand on a link, a bar in a text field.
 */
export const TEAM_BROWSER_VIEW_CURSOR_CAPABILITY = "browser-view-cursor";
/**
 * Present on the view socket when this client draws the cursor the host reports. A host sends no
 * cursor message to a client that did not ask: the desktop and web clients show their own pointer.
 */
export const BROWSER_VIEW_CURSOR_QUERY = "cursor";

export function browserViewClientWantsCursor(url: URL): boolean {
  return url.searchParams.get(BROWSER_VIEW_CURSOR_QUERY) === "1";
}

/**
 * A host that holds the page at the size a client asks for while that client's view is open. The
 * page otherwise has the size of the host's browser panel, so a client sees the page change shape
 * each time the host's window changes. A tab an agent gave a size of its own keeps that size.
 */
export const TEAM_BROWSER_VIEW_VIEWPORT_CAPABILITY = "browser-view-viewport";
/** The page size a client asks for on the view socket, in CSS pixels, as `1280x800`. */
export const BROWSER_VIEW_VIEWPORT_QUERY = "viewport";
export const BROWSER_VIEW_VIEWPORT_LIMITS = {
  minWidth: 320,
  minHeight: 240,
  maxWidth: 2_560,
  maxHeight: 2_560,
} as const;

export interface BrowserViewViewport {
  width: number;
  height: number;
}

export function browserViewViewportQuery(viewport: BrowserViewViewport): string {
  return `${Math.round(viewport.width)}x${Math.round(viewport.height)}`;
}

/** The page size this client asked for, or null when it asked for none or for a size out of bounds. */
export function browserViewClientViewport(url: URL): BrowserViewViewport | null {
  const match = /^(\d{3,4})x(\d{3,4})$/u.exec(url.searchParams.get(BROWSER_VIEW_VIEWPORT_QUERY) ?? "");
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const limits = BROWSER_VIEW_VIEWPORT_LIMITS;
  if (width < limits.minWidth || width > limits.maxWidth || height < limits.minHeight || height > limits.maxHeight)
    return null;
  return { width, height };
}

/**
 * A host that sends the menu of a right-click to the client that made it, as a `context-menu`
 * message, and does not open its own menu. The host's menu opens on the host's screen, where a
 * member on a phone never sees it. The menu's Select All is the client's Cmd+A or Ctrl+A.
 */
export const TEAM_BROWSER_VIEW_CONTEXT_MENU_CAPABILITY = "browser-view-context-menu";
/** Present on the view socket when this client shows the menu of its own right-clicks. */
export const BROWSER_VIEW_CONTEXT_MENU_QUERY = "menu";

export function browserViewClientWantsContextMenu(url: URL): boolean {
  return url.searchParams.get(BROWSER_VIEW_CONTEXT_MENU_QUERY) === "1";
}

/** The items of a page's context menu. A client leaves out an item it does not know. */
export const BROWSER_VIEW_CONTEXT_MENU_ITEMS = [
  "copy-link",
  "copy-image-address",
  "cut",
  "copy",
  "paste",
  "select-all",
] as const;
export type BrowserViewContextMenuItem = (typeof BROWSER_VIEW_CONTEXT_MENU_ITEMS)[number];
/** A link or an image address longer than this is not sent, and its copy item is left out. */
export const BROWSER_VIEW_CONTEXT_MENU_URL_MAX_LENGTH = 2_048;

/**
 * The cursors a host reports, by their CSS names. A host reports a cursor it has no name for here
 * as `default`, and a client draws a name it does not know as `default`.
 */
export const BROWSER_VIEW_CURSORS = [
  "default",
  "pointer",
  "text",
  "vertical-text",
  "crosshair",
  "cell",
  "wait",
  "progress",
  "help",
  "move",
  "grab",
  "grabbing",
  "not-allowed",
  "zoom-in",
  "zoom-out",
  "ew-resize",
  "ns-resize",
  "nesw-resize",
  "nwse-resize",
  "col-resize",
  "row-resize",
  "none",
] as const;
export type BrowserViewCursor = (typeof BROWSER_VIEW_CURSORS)[number];

/** The menu of a right-click that a client made, for a client that asked for it. */
export interface BrowserViewContextMenu {
  items: BrowserViewContextMenuItem[];
  /** The address of the link under the pointer, for `copy-link`. */
  link?: string;
  /** The address of the image under the pointer, for `copy-image-address`. */
  image?: string;
}

/**
 * What a host sends on the view socket as text, beside the binary frames: the answer to a copy, and
 * the cursor and the menus for a client that asked for them.
 */
export type BrowserViewHostMessage =
  | BrowserViewCopied
  | { type: "cursor"; cursor: BrowserViewCursor }
  | ({ type: "context-menu" } & BrowserViewContextMenu);

export function encodeBrowserViewHostMessage(message: BrowserViewHostMessage): string {
  return JSON.stringify(message);
}

/**
 * Null for a message that this client does not know: a newer host can send more. A client that
 * reads only `decodeBrowserViewCopied` asks for no cursor and no menu, so a host sends it neither.
 */
export function decodeBrowserViewHostMessage(value: string): BrowserViewHostMessage | null {
  return decodeHostMessageValue(JSON.parse(value));
}

function decodeHostMessageValue(message: unknown): BrowserViewHostMessage | null {
  if (!isDynamicRecord(message) || !isString(message.type)) throw new Error("Invalid browser view message.");
  if (message.type === "copied" || message.type === "copyTooLarge") return decodeBrowserViewCopiedValue(message);
  if (message.type === "cursor") {
    if (!isString(message.cursor)) throw new Error("Invalid browser view message.");
    const cursor = BROWSER_VIEW_CURSORS.find((name) => name === message.cursor) ?? "default";
    return { type: "cursor", cursor };
  }
  if (message.type === "context-menu") {
    const listed = message.items;
    if (!Array.isArray(listed) || listed.length > 32) throw new Error("Invalid browser view message.");
    const link = menuUrl(message.link);
    const image = menuUrl(message.image);
    const items = BROWSER_VIEW_CONTEXT_MENU_ITEMS.filter(
      (item) =>
        listed.includes(item) &&
        (item !== "copy-link" || link !== undefined) &&
        (item !== "copy-image-address" || image !== undefined),
    );
    return {
      type: "context-menu",
      items,
      ...(link === undefined ? {} : { link }),
      ...(image === undefined ? {} : { image }),
    };
  }
  return null;
}

function menuUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isString(value) || value.length > BROWSER_VIEW_CONTEXT_MENU_URL_MAX_LENGTH)
    throw new Error("Invalid browser view message.");
  return value;
}

/** A frame is one JPEG. The cap is generous for a photograph and refuses a stream that is not one. */
export const BROWSER_VIEW_MAX_FRAME_BYTES = 2 * 1024 * 1024;
/**
 * The most text one paste or one copy carries. A long article selected whole still fits, and the
 * message stays under the remote stream's 1 MiB text bound even when every character is escaped.
 */
export const BROWSER_VIEW_MAX_CLIPBOARD_TEXT = 100_000;
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
  /**
   * A client sends `char` only for a key whose `key` is one character. The host adds the character
   * of a named key itself, such as the `\r` of Enter, so a client that also sends it types it twice.
   */
  | { type: "key"; action: "down" | "up" | "char"; key: string; code: string; text: string; modifiers: number }
  | { type: "ack"; sequence: number }
  /** Text from the client's clipboard, inserted where the page has focus. */
  | { type: "paste"; text: string }
  /** Asks for the page's selection, which comes back as `copied`. */
  | { type: "copy" }
  /**
   * Deletes the selection after a cut, once its text is on the client's clipboard. The host deletes
   * only when the selection is still `text` and in a field the user can edit.
   */
  | { type: "cut"; text: string };

/**
 * The text message a host sends on the view socket, only in answer to a `copy`: the selection, or
 * word that it is longer than one message carries.
 */
export type BrowserViewCopied = { type: "copied"; text: string } | { type: "copyTooLarge" };

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
 * released payload, and it expands every point with its newest frame. An acknowledgement, a paste,
 * a copy and a cut are not part of that payload: an older host closes the view on an input it does
 * not know.
 */
export function browserViewInputForHost(
  input: BrowserViewInput,
  namesFrames: boolean,
  clipboard: boolean,
): BrowserViewInput | null {
  if (!namesFrames && input.type === "ack") return null;
  if (!clipboard && (input.type === "paste" || input.type === "copy" || input.type === "cut")) return null;
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
  if (message.type === "paste" || message.type === "cut") {
    if (!isBoundedString(message.text, BROWSER_VIEW_MAX_CLIPBOARD_TEXT) || message.text.length === 0) {
      throw new Error("Invalid browser view input.");
    }
    return { type: message.type, text: message.text };
  }
  if (message.type === "copy") return { type: "copy" };
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

export function encodeBrowserViewCopied(message: BrowserViewCopied): string {
  return JSON.stringify(message);
}

/** The client decodes what the host sends, with the same bound as a paste going the other way. */
export function decodeBrowserViewCopied(value: string): BrowserViewCopied {
  return decodeBrowserViewCopiedValue(JSON.parse(value));
}

function decodeBrowserViewCopiedValue(message: unknown): BrowserViewCopied {
  if (!isDynamicRecord(message)) throw new Error("Invalid browser view message.");
  if (message.type === "copyTooLarge") return { type: "copyTooLarge" };
  if (message.type !== "copied" || !isBoundedString(message.text, BROWSER_VIEW_MAX_CLIPBOARD_TEXT)) {
    throw new Error("Invalid browser view message.");
  }
  return { type: "copied", text: message.text };
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
