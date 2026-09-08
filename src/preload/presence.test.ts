import type { OpenBotDesktopApi, ScopedTeamPresenceSnapshot } from "@openbot/contracts/ipc";
import { IPC_CHANNELS } from "@openbot/contracts/ipc";
import { expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => {
  vi.stubGlobal("window", { addEventListener: () => {} });
  const api: { current: OpenBotDesktopApi | null } = { current: null };
  return { api, listeners: new Map<string, Set<(event: null, payload: ScopedTeamPresenceSnapshot) => void>>() };
});
vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: OpenBotDesktopApi) => {
      bridge.api.current = api;
    },
  },
  webUtils: {},
  ipcRenderer: {
    on: (channel: string, callback: (event: null, payload: ScopedTeamPresenceSnapshot) => void) => {
      const listeners = bridge.listeners.get(channel) ?? new Set();
      listeners.add(callback);
      bridge.listeners.set(channel, listeners);
    },
    removeListener: (channel: string, callback: (event: null, payload: ScopedTeamPresenceSnapshot) => void) =>
      bridge.listeners.get(channel)?.delete(callback),
  },
}));

import "./index";

it("delivers settings presence for an unselected server and removes the subscription on close", () => {
  if (!bridge.api.current) throw new Error("The preload API was not exposed.");
  const selected = vi.fn();
  const settings = vi.fn();
  const stopSelected = bridge.api.current.servers.onPresence(selected);
  const stopSettings = bridge.api.current.servers.onPresence(settings, "remote");
  const remote = { serverId: "remote", members: [], updatedAt: "2026-09-08T00:00:00Z" };
  for (const handler of bridge.listeners.get(IPC_CHANNELS.serversPresence) ?? [])
    handler(null, { serverId: "remote", snapshot: remote });
  expect(settings).toHaveBeenCalledWith(remote);
  expect(selected).not.toHaveBeenCalled();
  stopSettings();
  for (const handler of bridge.listeners.get(IPC_CHANNELS.serversPresence) ?? [])
    handler(null, { serverId: "remote", snapshot: remote });
  expect(settings).toHaveBeenCalledTimes(1);
  stopSelected();
});
