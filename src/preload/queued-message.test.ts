import { IPC_CHANNELS, type OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { expect, it, vi } from "vitest";

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
  ipcRenderer: { invoke: bridge.invoke, on: () => {}, removeListener: () => {} },
}));

import "./index";

it("takes a queued draft from the requested server and rejects invalid main-process data", async () => {
  const api = bridge.api.current;
  if (!api) throw new Error("The preload API was not exposed.");
  const draft = {
    text: "Draft",
    attachments: [
      {
        id: "draft-file",
        name: "notes.txt",
        mimeType: "text/plain",
        size: 5,
        kind: "file",
        previewKind: "none",
        previewUrl: null,
      },
    ],
  };
  bridge.invoke.mockResolvedValueOnce(draft);
  await expect(api.agent.takeQueuedMessage({ agentId: "chief", deliveryId: "queued" }, "remote")).resolves.toEqual(
    draft,
  );
  expect(bridge.invoke).toHaveBeenCalledWith(IPC_CHANNELS.agentTakeQueuedMessage, {
    serverId: "remote",
    payload: { agentId: "chief", deliveryId: "queued" },
  });
  bridge.invoke.mockResolvedValueOnce({ text: "Draft", attachments: [{}] });
  await expect(api.agent.takeQueuedMessage({ agentId: "chief", deliveryId: "queued" }, "remote")).rejects.toThrow(
    "Invalid attachment response.",
  );
});
