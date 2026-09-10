import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { IPC_CHANNELS } from "@openbot/contracts/ipc";
import { expect, it, vi } from "vitest";
import { parseAgentRequest } from "../main/ipc/agent-inputs";
import { requireString } from "../main/ipc/validation";

const bridge = vi.hoisted(() => {
  vi.stubGlobal("window", { addEventListener: () => {} });
  const api: { current: OpenBotDesktopApi | null } = { current: null };
  return { api, invoke: vi.fn() };
});
vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: OpenBotDesktopApi) => {
      bridge.api.current = api;
    },
  },
  webUtils: {},
  ipcRenderer: { invoke: bridge.invoke, on: () => {} },
}));

import "./index";

it("passes the channel identifier through the preload and main-process decoder", async () => {
  if (!bridge.api.current) throw new Error("The preload API was not exposed.");
  const deleted: string[] = [];
  bridge.invoke.mockImplementation(async (channel: string, request: unknown) => {
    if (channel !== IPC_CHANNELS.agentDeleteChannel) throw new Error("Unexpected IPC channel.");
    const scoped = parseAgentRequest(request);
    deleted.push(requireString(scoped.payload, "channelId"));
  });
  await bridge.api.current.agent.deleteChannel("channel-check");
  expect(deleted).toEqual(["channel-check"]);
});
