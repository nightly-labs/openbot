import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { IPC_CHANNELS } from "@openbot/contracts/ipc";
import { expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => {
  vi.stubGlobal("window", { addEventListener: () => {} });
  const api: { current: OpenBotDesktopApi | null } = { current: null };
  return { api, listeners: new Map<string, Set<(event: null, payload: unknown) => void>>() };
});
vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: OpenBotDesktopApi) => {
      bridge.api.current = api;
    },
  },
  webUtils: {},
  ipcRenderer: {
    on: (channel: string, callback: (event: null, payload: unknown) => void) => {
      const listeners = bridge.listeners.get(channel) ?? new Set();
      listeners.add(callback);
      bridge.listeners.set(channel, listeners);
    },
    removeListener: (channel: string, callback: (event: null, payload: unknown) => void) =>
      bridge.listeners.get(channel)?.delete(callback),
  },
}));

import "./index";

const send = (payload: unknown) => {
  for (const handler of bridge.listeners.get(IPC_CHANNELS.computerUseHighlightPlacement) ?? []) handler(null, payload);
};

const placement = {
  x: 10,
  y: 20,
  width: 800,
  height: 600,
  cornerRadius: 12,
  windowTitle: "Notes",
  cursor: { x: 40, y: 60 },
  covered: [{ x: 100, y: 200, width: 300, height: 400 }],
};

// The overlay draws this over another application's window, and it arrives on a channel the
// renderer cannot answer on, so a payload that is not a placement must not reach the surface.
it("delivers a placement and refuses one that is not a placement", () => {
  if (!bridge.api.current) throw new Error("The preload API was not exposed.");
  const drawn = vi.fn();
  const stop = bridge.api.current.onComputerUseHighlightPlacement(drawn);

  send(placement);
  expect(drawn).toHaveBeenCalledWith(placement);

  expect(() => send({ ...placement, width: "wide" })).toThrow("Invalid Computer Use highlight placement.");
  expect(() => send({ ...placement, windowTitle: undefined })).toThrow("Invalid Computer Use highlight placement.");
  expect(() => send({ ...placement, cursor: { x: 40 } })).toThrow("Invalid Computer Use highlight placement.");
  // The covered areas cut the rim away, so an entry that is not a rectangle would leave the rim
  // drawn whole over the window in front of the one it marks.
  expect(() => send({ ...placement, covered: {} })).toThrow("Invalid Computer Use highlight placement.");
  expect(() => send({ ...placement, covered: [{ x: 100, y: 200, width: 300 }] })).toThrow(
    "Invalid Computer Use highlight placement.",
  );
  expect(drawn).toHaveBeenCalledTimes(1);

  // No cursor is the ordinary case: the driver draws its own on a desktop of one display.
  send({ ...placement, cursor: null });
  expect(drawn).toHaveBeenLastCalledWith({ ...placement, cursor: null });

  stop();
  send(placement);
  expect(drawn).toHaveBeenCalledTimes(2);
});
