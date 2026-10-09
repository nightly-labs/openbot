import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import {
  type BrowserViewFrame,
  type BrowserViewHostMessage,
  type BrowserViewInput,
  decodeBrowserViewInputValue,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import { runTeamEffect } from "@openbot/team-client";
import { createRemoteBrowserView, type RemoteBrowserView } from "@openbot/team-client/browser-view";

// The phone's live view of a host browser tab runs in the hidden page that holds the Team peer: the
// frames arrive on its data channel, and the native screen has no channel of its own. The page
// sends each frame to the screen as base64, and the screen says when it has drawn one. Until then
// the page keeps only the newest frame, so a slow phone shows the page as it is now, not a queue.

/**
 * The page size the phone asks a host to hold while it watches: a laptop's page. The page keeps its
 * desktop layout, and its shape does not change when the host's window does. The host's frames are
 * at most this size, so a frame is not scaled down.
 */
export const BROWSER_VIEW_PAGE_SIZE = { width: 1_280, height: 800 };

/** One live view of a host browser tab, as the screen that shows it drives it. */
export interface RemoteBrowserViewSession {
  input(inputs: BrowserViewInput[]): void;
  /** The screen is done with a frame: drawn, or not decodable. The next frame comes after this. */
  frameDone(sequence: number, drawn: boolean): void;
  close(): void;
}

/** What the peer page tells the native screen about one view. */
export type BrowserViewBridgeEvent =
  | { type: "frame"; viewId: string; sequence: number; width: number; height: number; jpeg: string }
  | { type: "message"; viewId: string; message: BrowserViewHostMessage }
  /** The view ended. `reason` is the host's English text, or null when nobody gave one. */
  | { type: "ended"; viewId: string; reason: string | null };

// Types, not interfaces: a command crosses the bridge as JSON, and only a type alias is a JSON object.
export type BrowserViewBridgeOpen = {
  /** Names this view on both sides, so an event of a view the screen has left is dropped. */
  viewId: string;
  tabId: string;
  /** The host advertises `browser-view-frame-point`. */
  namesFrames: boolean;
  /** The host advertises `browser-view-cursor`. */
  cursor: boolean;
  /** The host advertises `browser-view-clipboard`. */
  clipboard: boolean;
  /** The host advertises `browser-view-context-menu`: the phone shows the menu of its right-clicks. */
  contextMenu: boolean;
  /** The page size to hold while the phone watches, for a host that advertises `browser-view-viewport`. */
  viewport: { width: number; height: number } | null;
};

/** What the native screen tells the peer page. */
export type BrowserViewBridgeCommand =
  | ({ type: "open" } & BrowserViewBridgeOpen)
  | { type: "close"; viewId: string }
  | { type: "input"; viewId: string; inputs: BrowserViewInput[] }
  /** The screen is done with a frame. `drawn` is false when the image could not be decoded. */
  | { type: "frame-done"; viewId: string; sequence: number; drawn: boolean };

interface OpenView {
  options: BrowserViewBridgeOpen;
  handle: RemoteBrowserView | null;
  /** A frame the screen has and has not drawn yet. */
  drawing: boolean;
  /** The newest frame that arrived while the screen was drawing. */
  waiting: BrowserViewFrame | null;
}

const BASE64_CHUNK = 0x8000;

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK));
  }
  return btoa(binary);
}

function pageSize(value: unknown): { width: number; height: number } | null {
  return isDynamicRecord(value) && isNumber(value.width) && isNumber(value.height)
    ? { width: value.width, height: value.height }
    : null;
}

function failureText(error: unknown): string | null {
  return error instanceof Error && error.message ? error.message : null;
}

export function createBrowserViewBridge(
  send: (data: string) => Promise<void>,
  request: (method: string, path: string, body?: { tabId: string }) => Promise<unknown>,
  emit: (event: BrowserViewBridgeEvent) => void,
) {
  let view: OpenView | null = null;
  const remote = createRemoteBrowserView(
    send,
    request,
    () => view?.options.namesFrames ?? false,
    () => view?.options.clipboard ?? false,
    () => ({
      cursor: view?.options.cursor ?? false,
      contextMenu: view?.options.contextMenu ?? false,
      viewport: view?.options.viewport ?? null,
    }),
  );

  const forward = (current: OpenView, frame: BrowserViewFrame) => {
    current.drawing = true;
    emit({
      type: "frame",
      viewId: current.options.viewId,
      sequence: frame.sequence,
      width: frame.width,
      height: frame.height,
      jpeg: base64(frame.image),
    });
  };

  const end = (current: OpenView, reason: string | null) => {
    if (view !== current) return;
    view = null;
    emit({ type: "ended", viewId: current.options.viewId, reason });
  };

  const deliver = (current: OpenView, input: BrowserViewInput) => {
    const handle = current.handle;
    if (!handle) return;
    // A refused input is one the view can no longer take; its end arrives as an event.
    void runTeamEffect(handle.input(input)).catch(() => undefined);
  };

  const open = async (options: BrowserViewBridgeOpen) => {
    const previous = view;
    const current: OpenView = { options, handle: null, drawing: false, waiting: null };
    view = current;
    if (previous?.handle) void runTeamEffect(previous.handle.close()).catch(() => undefined);
    try {
      const handle = await runTeamEffect(
        remote.open(
          options.tabId,
          (frame) => {
            if (view !== current) return;
            if (current.drawing) current.waiting = frame;
            else forward(current, frame);
          },
          (reason) => end(current, reason ?? null),
          (copied) => {
            if (view === current) emit({ type: "message", viewId: options.viewId, message: copied });
          },
          (message) => {
            if (view === current) emit({ type: "message", viewId: options.viewId, message });
          },
        ),
      );
      if (view !== current) {
        void runTeamEffect(handle.close()).catch(() => undefined);
        return;
      }
      current.handle = handle;
    } catch (error) {
      end(current, failureText(error));
    }
  };

  const close = (viewId: string) => {
    const current = view;
    if (current?.options.viewId !== viewId) return;
    view = null;
    if (current.handle) void runTeamEffect(current.handle.close()).catch(() => undefined);
  };

  /** Input from the native screen. Each value is read with the bounds the host reads it with. */
  const input = (viewId: string, inputs: readonly unknown[]) => {
    const current = view;
    if (current?.options.viewId !== viewId) return;
    for (const value of inputs) {
      let decoded: BrowserViewInput;
      try {
        decoded = decodeBrowserViewInputValue(value);
      } catch {
        continue;
      }
      deliver(current, decoded);
    }
  };

  /** The screen is done with this frame. The host may forget older ones, and the next frame can go. */
  const frameDone = (viewId: string, sequence: number, drawn: boolean) => {
    const current = view;
    if (current?.options.viewId !== viewId) return;
    if (drawn && current.options.namesFrames) deliver(current, { type: "ack", sequence });
    current.drawing = false;
    const next = current.waiting;
    current.waiting = null;
    if (next) forward(current, next);
  };

  return {
    receive: remote.receive,
    /** The connection is gone. The open view ends with its reason. */
    disconnect(reason: string | null) {
      remote.disconnect(reason ?? undefined);
    },
    /** A command from the native screen. It crossed the bridge as JSON, so each field is read here. */
    command(value: unknown) {
      if (!isDynamicRecord(value) || !isString(value.viewId)) return;
      const viewId = value.viewId;
      if (value.type === "open" && isString(value.tabId))
        void open({
          viewId,
          tabId: value.tabId,
          namesFrames: value.namesFrames === true,
          cursor: value.cursor === true,
          clipboard: value.clipboard === true,
          contextMenu: value.contextMenu === true,
          viewport: pageSize(value.viewport),
        });
      else if (value.type === "close") close(viewId);
      else if (value.type === "input" && Array.isArray(value.inputs)) input(viewId, value.inputs);
      else if (value.type === "frame-done" && isNumber(value.sequence))
        frameDone(viewId, value.sequence, value.drawn === true);
    },
  };
}
