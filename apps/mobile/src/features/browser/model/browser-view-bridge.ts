import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import {
  type BrowserViewFrame,
  type BrowserViewHostMessage,
  type BrowserViewInput,
  decodeBrowserViewInputValue,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import { runTeamEffect } from "@openbot/team-client";
import { bytesToBase64 } from "@openbot/team-client/base64";
import { createRemoteBrowserView, type RemoteBrowserView } from "@openbot/team-client/browser-view";
import { failureText } from "@/shared/lib/failure-text";

export const BROWSER_VIEW_PAGE_SIZE = { width: 1_280, height: 800 };

export interface RemoteBrowserViewSession {
  input(inputs: BrowserViewInput[]): void;
  frameDone(sequence: number, drawn: boolean): void;
  close(): void;
}

export type BrowserViewBridgeEvent =
  | { type: "frame"; viewId: string; sequence: number; width: number; height: number; jpeg: string }
  | { type: "message"; viewId: string; message: BrowserViewHostMessage }
  | { type: "ended"; viewId: string; reason: string | null };

export type BrowserViewBridgeOpen = {
  viewId: string;
  tabId: string;
  namesFrames: boolean;
  cursor: boolean;
  clipboard: boolean;
  contextMenu: boolean;
  viewport: { width: number; height: number } | null;
  pageCopy: boolean;
  dialog: boolean;
};

export type BrowserViewBridgeCommand =
  | ({ type: "open" } & BrowserViewBridgeOpen)
  | { type: "close"; viewId: string }
  | { type: "input"; viewId: string; inputs: BrowserViewInput[] }
  | { type: "frame-done"; viewId: string; sequence: number; drawn: boolean };

interface OpenView {
  options: BrowserViewBridgeOpen;
  handle: RemoteBrowserView | null;
  drawing: boolean;
  waiting: BrowserViewFrame | null;
}

function pageSize(value: unknown): { width: number; height: number } | null {
  return isDynamicRecord(value) && isNumber(value.width) && isNumber(value.height)
    ? { width: value.width, height: value.height }
    : null;
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
      pageCopy: view?.options.pageCopy ?? false,
      dialog: view?.options.dialog ?? false,
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
      jpeg: bytesToBase64(frame.image),
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
    disconnect(reason: string | null) {
      remote.disconnect(reason ?? undefined);
    },
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
          pageCopy: value.pageCopy === true,
          dialog: value.dialog === true,
        });
      else if (value.type === "close") close(viewId);
      else if (value.type === "input" && Array.isArray(value.inputs)) input(viewId, value.inputs);
      else if (value.type === "frame-done" && isNumber(value.sequence))
        frameDone(viewId, value.sequence, value.drawn === true);
    },
  };
}
