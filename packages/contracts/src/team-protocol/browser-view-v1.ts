import { INPUT_LIMITS } from "../input-limits";
import { isBoundedString, isIdentifier } from "../ipc-bounded-values";
import { isDynamicRecord, isNumber, isString } from "../runtime-values";

export const TEAM_BROWSER_VIEW_CAPABILITY = "browser-view";
export const TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY = "browser-view-frame-point";
export const TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY = "browser-view-clipboard";
export const BROWSER_VIEW_FRAME_ACK_QUERY = "frameAck";

export function browserViewClientAcksFrames(url: URL): boolean {
  return url.searchParams.get(BROWSER_VIEW_FRAME_ACK_QUERY) === "1";
}

export const TEAM_BROWSER_VIEW_CURSOR_CAPABILITY = "browser-view-cursor";
export const BROWSER_VIEW_CURSOR_QUERY = "cursor";

export function browserViewClientWantsCursor(url: URL): boolean {
  return url.searchParams.get(BROWSER_VIEW_CURSOR_QUERY) === "1";
}

export const TEAM_BROWSER_VIEW_VIEWPORT_CAPABILITY = "browser-view-viewport";
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

export const TEAM_BROWSER_VIEW_FRAME_SIZE_CAPABILITY = "browser-view-frame-size";
export const BROWSER_VIEW_FRAME_SIZE_QUERY = "frame";

export function browserViewFrameSizeQuery(size: BrowserViewViewport): string {
  const bound = (value: number) => (Number.isFinite(value) ? Math.min(9_999, Math.max(1, Math.round(value))) : 1);
  return `${bound(size.width)}x${bound(size.height)}`;
}

export function browserViewClientFrameSize(url: URL): BrowserViewViewport | null {
  const match = /^([1-9]\d{0,3})x([1-9]\d{0,3})$/u.exec(url.searchParams.get(BROWSER_VIEW_FRAME_SIZE_QUERY) ?? "");
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

export const TEAM_BROWSER_VIEW_CONTEXT_MENU_CAPABILITY = "browser-view-context-menu";
export const BROWSER_VIEW_CONTEXT_MENU_QUERY = "menu";

export function browserViewClientWantsContextMenu(url: URL): boolean {
  return url.searchParams.get(BROWSER_VIEW_CONTEXT_MENU_QUERY) === "1";
}

export const TEAM_BROWSER_VIEW_PAGE_COPY_CAPABILITY = "browser-view-page-copy-v1";
export const BROWSER_VIEW_PAGE_COPY_QUERY = "pageCopy";

export function browserViewClientWantsPageCopy(url: URL): boolean {
  return url.searchParams.get(BROWSER_VIEW_PAGE_COPY_QUERY) === "1";
}
export const BROWSER_VIEW_PAGE_COPY_AFTER_INPUT_MS = 5_000;

export const BROWSER_VIEW_CONTEXT_MENU_ITEMS = [
  "copy-link",
  "copy-image-address",
  "cut",
  "copy",
  "paste",
  "select-all",
] as const;
export type BrowserViewContextMenuItem = (typeof BROWSER_VIEW_CONTEXT_MENU_ITEMS)[number];
export const BROWSER_VIEW_CONTEXT_MENU_URL_MAX_LENGTH = 2_048;

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

export interface BrowserViewContextMenu {
  items: BrowserViewContextMenuItem[];
  link?: string;
  image?: string;
}

export type BrowserViewHostMessage =
  | BrowserViewCopied
  | { type: "cursor"; cursor: BrowserViewCursor }
  | ({ type: "context-menu" } & BrowserViewContextMenu)
  | { type: "pageCopied"; text: string };

export function encodeBrowserViewHostMessage(message: BrowserViewHostMessage): string {
  return JSON.stringify(message);
}

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
  if (message.type === "pageCopied") {
    if (!isBoundedString(message.text, BROWSER_VIEW_MAX_CLIPBOARD_TEXT) || message.text.length === 0)
      throw new Error("Invalid browser view message.");
    return { type: "pageCopied", text: message.text };
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

export const BROWSER_VIEW_MAX_FRAME_BYTES = 2 * 1024 * 1024;
export const BROWSER_VIEW_MAX_CLIPBOARD_TEXT = 100_000;
const FRAME_MAGIC = new Uint8Array([0x4f, 0x42, 0x56, 0x31]);
const FRAME_HEADER_BYTES = FRAME_MAGIC.byteLength + 8;

export function browserViewFrameBytes(frame: { image: Uint8Array }): number {
  return FRAME_HEADER_BYTES + frame.image.byteLength;
}

export interface BrowserViewFrame {
  sequence: number;
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
  streamPath: string;
}

export type BrowserViewInput =
  | {
      type: "pointer";
      action: "move" | "down" | "up" | "wheel";
      x: number;
      y: number;
      sequence?: number;
      button: "left" | "middle" | "right";
      clickCount: number;
      deltaX: number;
      deltaY: number;
      modifiers: number;
    }
  | { type: "key"; action: "down" | "up" | "char"; key: string; code: string; text: string; modifiers: number }
  | { type: "ack"; sequence: number }
  | { type: "paste"; text: string }
  | { type: "copy" }
  | { type: "cut"; text: string };

export function isBrowserViewUserAction(input: BrowserViewInput): boolean {
  return input.type === "key" || (input.type === "pointer" && (input.action === "down" || input.action === "up"));
}

export type BrowserViewCopied = { type: "copied"; text: string } | { type: "copyTooLarge" };

export function isBrowserViewSessionsRoute(method: string, path: string): boolean {
  return method === "POST" && pathname(path) === "/v1/browser/view/sessions";
}

export function isBrowserViewSessionRoute(method: string, path: string): boolean {
  return method === "DELETE" && /^\/v1\/browser\/view\/sessions\/[^/]+$/u.test(pathname(path));
}

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

export function decodeBrowserViewInput(value: string): BrowserViewInput {
  return decodeBrowserViewInputValue(JSON.parse(value));
}

export function decodeBrowserViewInputValue(message: unknown): BrowserViewInput {
  if (!isDynamicRecord(message)) throw new Error("Invalid browser view input.");
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
    if (text.length > 8) throw new Error("Invalid browser view input.");
    return { type: "key", action, key: message.key, code: message.code, text, modifiers };
  }
  throw new Error("Invalid browser view input.");
}

export function encodeBrowserViewCopied(message: BrowserViewCopied): string {
  return JSON.stringify(message);
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
