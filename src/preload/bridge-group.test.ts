import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { IPC_ENDPOINTS } from "@openbot/contracts/ipc";
import { beforeEach, expect, it, vi } from "vitest";

// `bridgeGroup` builds these methods from `IPC_ENDPOINTS`, so no line of the preload names them.
// These tests hold what the old literal methods held: the renderer sends at most its one input,
// and nothing main answers or pushes reaches the renderer undecoded.

const bridge = vi.hoisted(() => {
  vi.stubGlobal("window", { addEventListener: () => {} });
  const api: { current: OpenBotDesktopApi | null } = { current: null };
  return {
    api,
    invoke: vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(),
    listeners: new Map<string, Set<(event: null, payload: unknown) => void>>(),
  };
});
vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: OpenBotDesktopApi) => {
      bridge.api.current = api;
    },
  },
  webUtils: {},
  ipcRenderer: {
    invoke: bridge.invoke,
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

function api(): OpenBotDesktopApi {
  if (!bridge.api.current) throw new Error("The preload API was not exposed.");
  return bridge.api.current;
}

function send(channel: string, payload: unknown): void {
  for (const handler of bridge.listeners.get(channel) ?? []) handler(null, payload);
}

const status = { phase: "ready", progress: 100, message: null };

beforeEach(() => {
  bridge.invoke.mockReset();
});

it("sends at most one input, and none when the caller passes none", async () => {
  bridge.invoke.mockResolvedValue({ text: "Hello" });
  const input = { audio: new Uint8Array([1, 2]) };

  // A second argument is not part of the signature, but a renderer can still pass one: a method
  // with fewer parameters fits a callback type that has more, such as an event handler.
  const transcribe: (value: typeof input, extra: string) => Promise<unknown> = api().voice.transcribe;
  await expect(transcribe(input, "extra")).resolves.toEqual({ text: "Hello" });
  expect(bridge.invoke).toHaveBeenLastCalledWith(IPC_ENDPOINTS.voice.transcribe.channel, input);

  bridge.invoke.mockResolvedValue(status);
  await expect(api().voice.getModelStatus()).resolves.toEqual(status);
  expect(bridge.invoke).toHaveBeenLastCalledWith(IPC_ENDPOINTS.voice.getModelStatus.channel);
});

it("rejects a result that does not decode", async () => {
  bridge.invoke.mockResolvedValue({ phase: "unknown", progress: 100, message: null });

  await expect(api().voice.getModelStatus()).rejects.toThrow("Invalid voice model status.");
});

it("decodes an event and stops at unsubscribe", () => {
  const channel = IPC_ENDPOINTS.voice.modelStatus.channel;
  const listener = vi.fn();
  const stop = api().voice.onModelStatus(listener);

  send(channel, status);
  expect(listener).toHaveBeenCalledWith(status);
  expect(() => send(channel, { phase: "unknown", progress: 100, message: null })).toThrow(
    "Invalid voice model status.",
  );

  stop();
  expect(bridge.listeners.get(channel)?.size).toBe(0);
  send(channel, status);
  expect(listener).toHaveBeenCalledTimes(1);
});

// The slug began in a URL a web page chose. A bad one is dropped, as the guard before it did,
// rather than thrown into the listener of a window that did nothing wrong.
it("drops a deep-link event that does not decode", () => {
  const channel = IPC_ENDPOINTS.plugins.openListing.channel;
  const listener = vi.fn();
  api().plugins.onOpenListing(listener);

  expect(() => send(channel, "Not A Slug")).not.toThrow();
  expect(() => send(channel, 42)).not.toThrow();
  expect(listener).not.toHaveBeenCalled();

  send(channel, "weather-tools");
  expect(listener).toHaveBeenCalledWith("weather-tools");
});
