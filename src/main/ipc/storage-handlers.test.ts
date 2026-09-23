// @vitest-environment node

// Storage reaches the local host or a joined server by the server the surface names. A host without
// `storage-v1` reads as null, so the surface asks for an update, and refuses a change before any
// request. The handlers register through the trusted binder, so Electron is mocked.

import { IPC_CHANNELS, LOCAL_SERVER_ID, type StorageUsage } from "@openbot/contracts/ipc";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";
import { describe, expect, it, vi } from "vitest";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";

type Invoke = (event: unknown, request: unknown) => unknown;
const { bound, showItemInFolder } = vi.hoisted(() => ({
  bound: new Map<string, Invoke>(),
  showItemInFolder: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { getPath: () => "/tmp" },
  dialog: {},
  shell: { showItemInFolder },
  ipcMain: { handle: (channel: string, invoke: Invoke) => bound.set(channel, invoke) },
}));
const { registerIpcGroup } = await import("./define-ipc-group");
const { storageIpcHandlers } = await import("./storage-handlers");

const TRUSTED_EVENT = { senderFrame: { url: "openbot-app://app/index.html" } };

function usageFor(agentId: string): StorageUsage {
  return {
    scope: "agent",
    agentId,
    conversationId: null,
    scannedAt: "2026-09-23T10:00:00.000Z",
    freeBytes: 10,
    breakdown: [{ category: "workspaces", bytes: 4, removable: false }],
    agents: [],
    conversations: [],
    files: [],
    truncated: false,
  };
}

function setup(options: { capable: boolean; answer?: unknown }) {
  bound.clear();
  const storage = {
    usage: vi.fn(async () => usageFor("chief")),
    deleteFile: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  };
  const requests: { serverId: string; path: string; init?: RemoteRequestInit }[] = [];
  const remoteServers = {
    supportsCapability: () => options.capable,
    request: async <T>(serverId: string, path: string, decoder: ResponseDecoder<T>, init?: RemoteRequestInit) => {
      requests.push({ serverId, path, init });
      return decoder(options.answer ?? {});
    },
    downloadAttachment: vi.fn(),
  };
  const mailbox = {
    resolveAttachment: vi.fn(async () => ({ path: "/transfers/report.pdf", mimeType: "application/pdf", name: "a" })),
  };
  const openPath = vi.fn(async () => "");
  registerIpcGroup(
    "storage",
    storageIpcHandlers({
      storage,
      mailbox,
      remoteServers,
      getMainWindow: () => null,
      agents: () => [{ id: "chief", workspacePath: "/workspaces/chief" }],
      openPath,
    }).storage,
  );
  // Async like `ipcMain.handle`: a parser that throws reaches the renderer as a rejection.
  const invoke = async (channel: string, request: unknown) => {
    const handler = bound.get(channel);
    if (!handler) throw new Error(`${channel} was not registered.`);
    return handler(TRUSTED_EVENT, request);
  };
  const call = (channel: string, serverId: string, payload: unknown) => invoke(channel, { serverId, payload });
  return { storage, requests, mailbox, openPath, call, invoke };
}

describe("storageIpcHandlers", () => {
  it("reads the local host from the service and a remote host over storage-v1", async () => {
    const local = setup({ capable: false });
    await expect(
      local.call(IPC_CHANNELS.storageGetUsage, LOCAL_SERVER_ID, { scope: "agent", agentId: "chief" }),
    ).resolves.toEqual(usageFor("chief"));
    expect(local.storage.usage).toHaveBeenCalledWith({ scope: "agent", agentId: "chief" });

    // An older host: nothing is requested, and the surface reads null.
    await expect(
      local.call(IPC_CHANNELS.storageGetUsage, "remote-1", { scope: "agent", agentId: "chief" }),
    ).resolves.toBeNull();
    expect(local.requests).toEqual([]);

    const remote = setup({ capable: true, answer: usageFor("chief") });
    await expect(
      remote.call(IPC_CHANNELS.storageGetUsage, "remote-1", { scope: "agent", agentId: "chief", force: true }),
    ).resolves.toEqual(usageFor("chief"));
    expect(remote.requests).toEqual([
      {
        serverId: "remote-1",
        path: STORAGE_ROUTES.usage,
        init: { method: "POST", body: { scope: "agent", agentId: "chief", force: true } },
      },
    ]);
    // A host that answers for another agent would show that agent's files in this panel.
    await expect(
      remote.call(IPC_CHANNELS.storageGetUsage, "remote-1", { scope: "agent", agentId: "writer" }),
    ).rejects.toThrow("Storage response does not match the request.");
  });

  it("refuses a remote change without the capability and posts it with one", async () => {
    const old = setup({ capable: false });
    await expect(old.call(IPC_CHANNELS.storageDeleteFile, "remote-1", { fileId: "sent" })).rejects.toThrow(
      "Storage is not supported by this server.",
    );
    expect(old.requests).toEqual([]);

    const remote = setup({ capable: true });
    await remote.call(IPC_CHANNELS.storageDeleteFile, "remote-1", { fileId: "sent" });
    await remote.call(IPC_CHANNELS.storageClear, "remote-1", { category: "caches" });
    expect(remote.requests.map((request) => [request.path, request.init?.body])).toEqual([
      [STORAGE_ROUTES.deleteFile, { fileId: "sent" }],
      [STORAGE_ROUTES.clear, { category: "caches" }],
    ]);
    await expect(remote.call(IPC_CHANNELS.storageClear, "remote-1", { category: "workspaces" })).rejects.toThrow();

    await remote.call(IPC_CHANNELS.storageDeleteFile, LOCAL_SERVER_ID, { fileId: "sent" });
    expect(remote.storage.deleteFile).toHaveBeenCalledWith("sent");
  });

  it("opens a stored file as an attachment and an agent's workspace on this computer", async () => {
    const local = setup({ capable: false });
    await local.call(IPC_CHANNELS.storageOpenFile, LOCAL_SERVER_ID, { fileId: "sent", action: "reveal" });
    expect(local.mailbox.resolveAttachment).toHaveBeenCalledWith("sent");
    expect(showItemInFolder).toHaveBeenCalledWith("/transfers/report.pdf");

    await local.invoke(IPC_CHANNELS.storageOpenLocation, { agentId: "chief" });
    expect(local.openPath).toHaveBeenCalledWith("/workspaces/chief");
    await expect(local.invoke(IPC_CHANNELS.storageOpenLocation, { agentId: "gone" })).rejects.toThrow(
      "The agent does not exist.",
    );
  });
});
