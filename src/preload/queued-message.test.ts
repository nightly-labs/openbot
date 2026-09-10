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

it("validates a recovered queue edit and preserves its requested server", async () => {
  const api = bridge.api.current;
  if (!api) throw new Error("The preload API was not exposed.");
  const input = { agentId: "chief", operation: "read" as const };
  const edit = { deliveryId: "delivery", revision: 2, text: "Held", attachments: [], replyToMessageId: null };
  bridge.invoke.mockResolvedValueOnce(edit);
  await expect(api.agent.queueEdit(input, "remote")).resolves.toEqual(edit);
  expect(bridge.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.agentQueueEdit, { serverId: "remote", payload: input });
  bridge.invoke.mockResolvedValueOnce({ ...edit, revision: 0 });
  await expect(api.agent.queueEdit(input, "remote")).rejects.toThrow("Invalid queue edit state.");
});
