import type { RemoteTeamPeerActions } from "@openbot/team-client/remote-peer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORY_AGENT_SUMMARIES } from "../../preview/fixtures";
import { createWebWorkspaceRuntime, decodeWebConversationPage } from "./web-runtime";

const peer = {
  execute: vi.fn(),
  dispose: vi.fn(),
  sendHostStreamData: vi.fn(),
  cancelUpload: vi.fn(),
  setActive: vi.fn(),
};
const host = {
  hostId: "host",
  name: "Host",
  logoKey: null,
  devicePublicKey: "key-one",
  membershipId: "membership",
  role: "owner" as const,
};
const snapshot = { agentId: "agent", threadId: "thread", activeTurnId: null, revision: 1, messages: [] };
function create(account = "one") {
  return createWebWorkspaceRuntime(
    account,
    { connection: vi.fn(), event: vi.fn(), accountChanged: async () => {} },
    vi.fn(),
    { createPeer: () => peer, acquireHostLock: async () => () => {} },
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  peer.dispose.mockResolvedValue(undefined);
  peer.cancelUpload.mockResolvedValue(undefined);
  peer.execute.mockImplementation(async (command) => ({
    ok: true,
    status: 200,
    body:
      command.path === "/v1/compatibility"
        ? { appVersion: "0.1.0", protocol: { minimum: 1, maximum: 4 }, capabilities: ["conversation-pagination"] }
        : {},
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("browser workspace runtime", () => {
  it("reads the host sidebar layout and validates account usage", async () => {
    peer.execute.mockImplementation(async (command) => ({
      ok: true,
      status: 200,
      body:
        command.path === "/v1/compatibility"
          ? { appVersion: "0.1.0", protocol: { minimum: 1, maximum: 4 }, capabilities: ["sidebar-layout"] }
          : command.path === "/v1/sidebar-layout" || command.path === "/v1/sidebar-layout/actions"
            ? {
                revision: 3,
                sections: [{ id: "research", name: "Research" }],
                order: ["people", "research", "unassigned"],
                agentAssignments: { agent: "research" },
                agentOrder: ["agent"],
              }
            : command.path === "/v1/agents/usage"
              ? { limits: [{ id: "codex", primary: null, secondary: null }] }
              : {},
    }));
    const runtime = create();
    await runtime.connect(host);
    if (!runtime.getSidebarLayout || !runtime.accountUsage) throw new Error("Runtime methods are unavailable.");
    await expect(runtime.getSidebarLayout()).resolves.toMatchObject({ revision: 3 });
    if (!runtime.mutateSidebarLayout) throw new Error("Runtime sidebar mutation is unavailable.");
    await expect(
      runtime.mutateSidebarLayout({ type: "rename", sectionId: "research", name: "Work" }),
    ).resolves.toMatchObject({ revision: 3 });
    await expect(runtime.accountUsage()).resolves.toEqual({
      limits: [{ id: "codex", primary: null, secondary: null }],
    });
    await runtime.dispose();
  });

  it("rejects malformed account usage from the host", async () => {
    const runtime = create();
    await runtime.connect(host);
    peer.execute.mockResolvedValue({
      ok: true,
      status: 200,
      body: { limits: [{ id: "codex", primary: { usedPercent: "25" }, secondary: null }] },
    });
    if (!runtime.accountUsage) throw new Error("Runtime account usage is unavailable.");
    await expect(runtime.accountUsage()).rejects.toThrow("invalid account usage");
    await runtime.dispose();
  });

  it("reuses one duplicate operation after an uncertain host response", async () => {
    const operationIds: unknown[] = [];
    let duplicateAttempts = 0;
    const duplicate = {
      ...STORY_AGENT_SUMMARIES[1],
      id: "agent-copy",
      name: "Research copy",
      threadId: null,
    };
    const layout = {
      revision: 2,
      sections: [],
      order: ["people", "unassigned"],
      agentAssignments: {},
      agentOrder: ["agent", "agent-copy"],
    };
    peer.execute.mockImplementation(async (command) => {
      if (command.path === "/v1/agents/agent/duplicate") {
        duplicateAttempts += 1;
        operationIds.push(command.body?.operationId);
        if (duplicateAttempts === 1) throw new Error("connection reset");
        return { ok: true, status: 201, body: { agent: duplicate, layout } };
      }
      return {
        ok: true,
        status: 200,
        body:
          command.path === "/v1/compatibility"
            ? {
                appVersion: "0.1.0",
                protocol: { minimum: 1, maximum: 4 },
                capabilities: ["agent-duplication"],
              }
            : {},
      };
    });
    const runtime = create();
    await runtime.connect(host);
    await expect(runtime.duplicateAgent("agent")).rejects.toThrow("connection reset");
    await runtime.disconnect();
    await runtime.connect(host);
    await expect(runtime.duplicateAgent("agent")).resolves.toEqual({ agent: duplicate, layout });
    expect(duplicateAttempts).toBe(2);
    expect(operationIds[0]).toEqual(operationIds[1]);
    expect(peer.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "request", method: "POST", path: "/v1/agents/agent/duplicate" }),
    );
    await runtime.deleteAgent("agent-copy");
    expect(peer.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "request", method: "DELETE", path: "/v1/agents/agent-copy" }),
    );
    await runtime.dispose();
  });

  it("rejects agent deletion for a host member before sending a request", async () => {
    const runtime = create();
    await runtime.connect({ ...host, role: "member" });
    peer.execute.mockClear();
    await expect(runtime.deleteAgent("agent")).rejects.toThrow("Members cannot delete agents");
    expect(peer.execute).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it("does not accept a sidebar layout response after the host changes", async () => {
    let resolveLayout: ((value: unknown) => void) | undefined;
    peer.execute.mockImplementation(async (command) => {
      if (command.path === "/v1/sidebar-layout") {
        return await new Promise((resolve) => {
          resolveLayout = resolve;
        });
      }
      return {
        ok: true,
        status: 200,
        body:
          command.path === "/v1/compatibility"
            ? { appVersion: "0.1.0", protocol: { minimum: 1, maximum: 4 }, capabilities: ["sidebar-layout"] }
            : {},
      };
    });
    const runtime = create();
    await runtime.connect(host);
    if (!runtime.getSidebarLayout) throw new Error("Runtime sidebar layout is unavailable.");
    const pending = runtime.getSidebarLayout();
    await vi.waitFor(() => expect(resolveLayout).toBeDefined());
    await runtime.connect({ ...host, hostId: "other-host", devicePublicKey: "other-key" });
    resolveLayout?.({
      revision: 1,
      sections: [],
      order: ["people", "unassigned"],
      agentAssignments: {},
      agentOrder: [],
    });
    await expect(pending).rejects.toThrow("selected host changed");
    await runtime.dispose();
  });

  it("keeps trusted host keys separate by account and rejects replacement identities", async () => {
    const runtime = create();
    await runtime.connect(host);
    expect(localStorage.getItem("openbot.web.host-key:one:host")).toBe("key-one");
    await expect(runtime.connect({ ...host, devicePublicKey: "key-two" })).rejects.toThrow("identity changed");
    expect(localStorage.getItem("openbot.web.host-key:one:host")).toBe("key-one");
    const other = create("two");
    await other.connect({ ...host, devicePublicKey: "key-two" });
    expect(localStorage.getItem("openbot.web.host-key:two:host")).toBe("key-two");
    await runtime.dispose();
    await other.dispose();
  });
  it("releases the host lock when host identity validation fails", async () => {
    const release = vi.fn();
    const acquireHostLock = vi.fn(async () => release);
    const runtime = createWebWorkspaceRuntime(
      "one",
      { connection: vi.fn(), event: vi.fn(), accountChanged: async () => {} },
      vi.fn(),
      { createPeer: () => peer, acquireHostLock },
    );
    await runtime.connect(host);
    await expect(runtime.connect({ ...host, devicePublicKey: "key-two" })).rejects.toThrow("identity changed");
    expect(release).toHaveBeenCalledOnce();
    await runtime.dispose();
    expect(release).toHaveBeenCalledOnce();
  });
  it("closes an incompatible host connection", async () => {
    peer.execute.mockResolvedValue({
      ok: true,
      status: 200,
      body: { appVersion: "0.1.0", protocol: { minimum: 8, maximum: 8 }, capabilities: [] },
    });
    const runtime = create();
    await expect(runtime.connect(host)).rejects.toThrow("not compatible");
    expect(peer.execute).toHaveBeenLastCalledWith(expect.objectContaining({ type: "disconnect" }));
    await runtime.dispose();
  });
  it("uses the legacy history endpoint when pagination is unavailable", async () => {
    peer.execute.mockImplementation(async (command) => ({
      ok: true,
      status: 200,
      body:
        command.path === "/v1/compatibility"
          ? { appVersion: "0.1.0", protocol: { minimum: 1, maximum: 4 }, capabilities: [] }
          : snapshot,
    }));
    const runtime = create();
    await runtime.connect(host);
    await expect(runtime.conversation("agent")).resolves.toMatchObject({
      ...snapshot,
      pageInfo: { hasOlder: false, olderCursor: null },
    });
    expect(peer.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: "GET", path: "/v1/agents/agent/conversation" }),
    );
    await runtime.dispose();
  });
  it("does not accept message delivery without a valid queue receipt", async () => {
    const runtime = create();
    await runtime.connect(host);
    await expect(runtime.send("agent", "hello", [])).rejects.toThrow("not confirmed");
    await runtime.dispose();
  });
  it("rejects oversized and unsupported files before starting a transfer", async () => {
    const runtime = create();
    await runtime.connect(host);
    peer.execute.mockClear();
    await expect(runtime.upload(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.txt"))).rejects.toThrow(
      "10 MB",
    );
    await expect(runtime.upload(new File(["email"], "mail.eml"))).rejects.toThrow("Update the host");
    expect(peer.execute).not.toHaveBeenCalled();
    await runtime.dispose();
  });
  it("preserves downloaded bytes and rejects files above the browser limit", async () => {
    const runtime = create();
    await runtime.connect(host);
    const file = { name: "fixture.txt", mimeType: "text/plain", base64: btoa("download fixture") };
    peer.execute.mockResolvedValue({ ok: true, status: 200, body: file });
    await expect(runtime.download("attachment")).resolves.toEqual(file);
    const limit = 10 * 1024 * 1024;
    for (const size of [limit, limit + 1, limit + 3]) {
      peer.execute.mockResolvedValue({ ok: true, status: 200, body: { ...file, base64: btoa("a".repeat(size)) } });
      if (size === limit) await expect(runtime.download("attachment")).resolves.toMatchObject({ name: file.name });
      else await expect(runtime.download("attachment")).rejects.toThrow("10 MB");
    }
    await runtime.dispose();
  });
  it("rejects invalid pagination rather than hiding missing messages", () => {
    expect(() =>
      decodeWebConversationPage({ ...snapshot, references: {}, pageInfo: { hasOlder: true, olderCursor: null } }),
    ).toThrow("invalid conversation page");
  });
  it("does not upload a file to a new host when reading the file finishes after disconnect", async () => {
    const runtime = create();
    await runtime.connect(host);
    let finishRead: (bytes: ArrayBuffer) => void = () => {};
    const file = new File(["hello"], "hello.txt");
    file.arrayBuffer = () =>
      new Promise<ArrayBuffer>((resolve) => {
        finishRead = resolve;
      });
    const upload = runtime.upload(file);
    const rejected = expect(upload).rejects.toThrow("cancelled");
    await runtime.disconnect();
    peer.execute.mockClear();
    finishRead(new ArrayBuffer(5));
    await rejected;
    expect(peer.execute).not.toHaveBeenCalled();
    await runtime.dispose();
  });
  it("cancels uploads before reconnecting or disconnecting the peer", async () => {
    const runtime = create();
    await runtime.connect(host);
    peer.cancelUpload.mockClear();
    peer.execute.mockClear();
    await runtime.connect(host);
    expect(peer.cancelUpload).toHaveBeenCalledOnce();
    const reconnect = peer.execute.mock.invocationCallOrder.find(
      (_order, index) => peer.execute.mock.calls[index]?.[0]?.type === "connect",
    );
    expect(reconnect).toBeDefined();
    expect(peer.cancelUpload.mock.invocationCallOrder[0]).toBeLessThan(reconnect ?? Number.POSITIVE_INFINITY);

    peer.cancelUpload.mockClear();
    peer.execute.mockClear();
    await runtime.disconnect();
    expect(peer.cancelUpload).toHaveBeenCalledOnce();
    const disconnect = peer.execute.mock.invocationCallOrder.find(
      (_order, index) => peer.execute.mock.calls[index]?.[0]?.type === "disconnect",
    );
    expect(disconnect).toBeDefined();
    expect(peer.cancelUpload.mock.invocationCallOrder[0]).toBeLessThan(disconnect ?? Number.POSITIVE_INFINITY);
    await runtime.dispose();
  });
  it("releases the browser view session before disconnecting the peer", async () => {
    peer.execute.mockImplementation(async (command) => ({
      ok: true,
      status: 200,
      body:
        command.path === "/v1/compatibility"
          ? {
              appVersion: "0.1.0",
              protocol: { minimum: 1, maximum: 4 },
              capabilities: ["browser-view"],
            }
          : command.path === "/v1/browser/view/sessions"
            ? { id: "view", tabId: "tab", streamPath: "/v1/browser/view/sessions/view/stream" }
            : {},
    }));
    const runtime = create();
    await runtime.connect(host);
    await runtime.browser.startLiveView("tab");
    peer.execute.mockClear();
    await runtime.disconnect();
    const deleteSession = peer.execute.mock.invocationCallOrder.find(
      (_order, index) =>
        peer.execute.mock.calls[index]?.[0]?.type === "request" &&
        peer.execute.mock.calls[index]?.[0]?.method === "DELETE" &&
        peer.execute.mock.calls[index]?.[0]?.path === "/v1/browser/view/sessions/view",
    );
    const disconnect = peer.execute.mock.invocationCallOrder.find(
      (_order, index) => peer.execute.mock.calls[index]?.[0]?.type === "disconnect",
    );
    expect(deleteSession).toBeDefined();
    expect(disconnect).toBeDefined();
    expect(deleteSession).toBeLessThan(disconnect ?? Number.POSITIVE_INFINITY);
    await runtime.dispose();
  });
  it("releases the browser view session before disposing the peer", async () => {
    peer.execute.mockImplementation(async (command) => ({
      ok: true,
      status: 200,
      body:
        command.path === "/v1/compatibility"
          ? {
              appVersion: "0.1.0",
              protocol: { minimum: 1, maximum: 4 },
              capabilities: ["browser-view"],
            }
          : command.path === "/v1/browser/view/sessions"
            ? { id: "view", tabId: "tab", streamPath: "/v1/browser/view/sessions/view/stream" }
            : {},
    }));
    const runtime = create();
    await runtime.connect(host);
    await runtime.browser.startLiveView("tab");
    peer.execute.mockClear();
    peer.dispose.mockClear();
    await runtime.dispose();
    const deleteSession = peer.execute.mock.invocationCallOrder.find(
      (_order, index) =>
        peer.execute.mock.calls[index]?.[0]?.type === "request" &&
        peer.execute.mock.calls[index]?.[0]?.method === "DELETE" &&
        peer.execute.mock.calls[index]?.[0]?.path === "/v1/browser/view/sessions/view",
    );
    expect(deleteSession).toBeDefined();
    expect(peer.dispose).toHaveBeenCalledOnce();
    expect(deleteSession).toBeLessThan(peer.dispose.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY);
  });
  it("releases the browser view session before switching peers", async () => {
    peer.execute.mockImplementation(async (command) => ({
      ok: true,
      status: 200,
      body:
        command.path === "/v1/compatibility"
          ? {
              appVersion: "0.1.0",
              protocol: { minimum: 1, maximum: 4 },
              capabilities: ["browser-view"],
            }
          : command.path === "/v1/browser/view/sessions"
            ? { id: "view", tabId: "tab", streamPath: "/v1/browser/view/sessions/view/stream" }
            : {},
    }));
    const runtime = create();
    await runtime.connect(host);
    await runtime.browser.startLiveView("tab");
    peer.execute.mockClear();
    await runtime.connect({ ...host, hostId: "other-host", devicePublicKey: "other-key" });
    const deleteSession = peer.execute.mock.invocationCallOrder.find(
      (_order, index) =>
        peer.execute.mock.calls[index]?.[0]?.type === "request" &&
        peer.execute.mock.calls[index]?.[0]?.method === "DELETE" &&
        peer.execute.mock.calls[index]?.[0]?.path === "/v1/browser/view/sessions/view",
    );
    const disconnect = peer.execute.mock.invocationCallOrder.find(
      (_order, index) => peer.execute.mock.calls[index]?.[0]?.type === "disconnect",
    );
    expect(deleteSession).toBeDefined();
    expect(disconnect).toBeDefined();
    expect(deleteSession).toBeLessThan(disconnect ?? Number.POSITIVE_INFINITY);
    await runtime.dispose();
  });
  it("discards completed drafts before switching hosts without deleting them on the new host", async () => {
    const draft = {
      id: "draft",
      name: "draft.txt",
      size: 5,
      kind: "file" as const,
      mimeType: "text/plain",
      previewKind: "text" as const,
      previewUrl: null,
    };
    peer.execute.mockImplementation(async (command) => ({
      ok: true,
      status: 200,
      body:
        command.path === "/v1/compatibility"
          ? { appVersion: "0.1.0", protocol: { minimum: 1, maximum: 4 }, capabilities: [] }
          : command.method === "POST" && command.path?.startsWith("/v1/attachments?")
            ? draft
            : {},
    }));
    const runtime = create();
    await runtime.connect(host);
    await expect(runtime.upload(new File(["draft"], draft.name, { type: draft.mimeType }))).resolves.toEqual(draft);
    peer.execute.mockClear();
    await runtime.connect({ ...host, hostId: "other-host", devicePublicKey: "other-key" });
    const deleteDraft = peer.execute.mock.invocationCallOrder.find(
      (_order, index) =>
        peer.execute.mock.calls[index]?.[0]?.type === "request" &&
        peer.execute.mock.calls[index]?.[0]?.method === "DELETE" &&
        peer.execute.mock.calls[index]?.[0]?.path === "/v1/attachments/draft",
    );
    const disconnect = peer.execute.mock.invocationCallOrder.find(
      (_order, index) => peer.execute.mock.calls[index]?.[0]?.type === "disconnect",
    );
    expect(deleteDraft).toBeDefined();
    expect(disconnect).toBeDefined();
    expect(deleteDraft).toBeLessThan(disconnect ?? Number.POSITIVE_INFINITY);

    peer.execute.mockClear();
    await runtime.disconnect();
    expect(peer.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "request", method: "DELETE", path: "/v1/attachments/draft" }),
    );
    await runtime.dispose();
  });
  it("preserves a completed draft across a same-host reconnect until send", async () => {
    const draft = {
      id: "draft",
      name: "draft.txt",
      size: 5,
      kind: "file" as const,
      mimeType: "text/plain",
      previewKind: "text" as const,
      previewUrl: null,
    };
    peer.execute.mockImplementation(async (command) => ({
      ok: true,
      status: 200,
      body:
        command.path === "/v1/compatibility"
          ? { appVersion: "0.1.0", protocol: { minimum: 1, maximum: 4 }, capabilities: [] }
          : command.method === "POST" && command.path?.startsWith("/v1/attachments?")
            ? draft
            : command.method === "POST" && command.path === "/v1/agents/agent/messages"
              ? {
                  messageId: "message",
                  deliveries: [{ id: "delivery", recipientAgentId: "agent", status: "queued", position: 1 }],
                }
              : {},
    }));
    const runtime = create();
    await runtime.connect(host);
    await runtime.upload(new File(["draft"], draft.name, { type: draft.mimeType }));
    peer.execute.mockClear();
    await runtime.connect(host);
    expect(peer.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "request", method: "DELETE", path: "/v1/attachments/draft" }),
    );
    await runtime.send("agent", "hello", [draft.id]);
    expect(peer.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "request",
        method: "POST",
        path: "/v1/agents/agent/messages",
        body: expect.objectContaining({ attachmentDraftIds: [draft.id] }),
      }),
    );
    peer.execute.mockClear();
    await runtime.disconnect();
    expect(peer.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "request", method: "DELETE", path: "/v1/attachments/draft" }),
    );
    await runtime.dispose();
  });
  it("retries failed draft cleanup after an explicit disconnect and same-host reconnect", async () => {
    const draft = {
      id: "draft",
      name: "draft.txt",
      size: 5,
      kind: "file" as const,
      mimeType: "text/plain",
      previewKind: "text" as const,
      previewUrl: null,
    };
    let deleteAttempts = 0;
    peer.execute.mockImplementation(async (command) => {
      if (command.path === "/v1/compatibility") {
        return {
          ok: true,
          status: 200,
          body: { appVersion: "0.1.0", protocol: { minimum: 1, maximum: 4 }, capabilities: [] },
        };
      }
      if (command.method === "POST" && command.path?.startsWith("/v1/attachments?")) {
        return { ok: true, status: 200, body: draft };
      }
      if (command.method === "DELETE" && command.path === "/v1/attachments/draft") {
        deleteAttempts += 1;
        if (deleteAttempts === 1) throw new Error("temporary cleanup failure");
      }
      return { ok: true, status: 200, body: {} };
    });
    const runtime = create();
    await runtime.connect(host);
    await runtime.upload(new File(["draft"], draft.name, { type: draft.mimeType }));
    await runtime.disconnect();
    expect(deleteAttempts).toBe(1);

    peer.execute.mockClear();
    await runtime.connect(host);
    expect(deleteAttempts).toBe(2);
    const reconnect = peer.execute.mock.calls.findIndex(([command]) => command.type === "connect");
    const retry = peer.execute.mock.calls.findIndex(
      ([command]) =>
        command.type === "request" && command.method === "DELETE" && command.path === "/v1/attachments/draft",
    );
    expect(reconnect).toBeGreaterThanOrEqual(0);
    expect(retry).toBeGreaterThan(reconnect);
    await runtime.dispose();
  });
  it("does not install a browser view that finishes after it was stopped", async () => {
    let resolveSession: ((value: unknown) => void) | undefined;
    peer.execute.mockImplementation(async (command) => {
      if (command.path === "/v1/compatibility") {
        return {
          ok: true,
          status: 200,
          body: { appVersion: "0.1.0", protocol: { minimum: 1, maximum: 4 }, capabilities: ["browser-view"] },
        };
      }
      if (command.path === "/v1/browser/view/sessions") {
        return await new Promise((resolve) => {
          resolveSession = resolve;
        });
      }
      return { ok: true, status: 200, body: {} };
    });
    const runtime = create();
    await runtime.connect(host);
    const opening = runtime.browser.startLiveView("tab");
    await vi.waitFor(() =>
      expect(peer.execute).toHaveBeenCalledWith(
        expect.objectContaining({ type: "request", method: "POST", path: "/v1/browser/view/sessions" }),
      ),
    );
    await runtime.browser.stopLiveView();
    resolveSession?.({
      ok: true,
      status: 200,
      body: { id: "view", tabId: "tab", streamPath: "/v1/browser/view/sessions/view/stream" },
    });
    await expect(opening).rejects.toThrow("changed");
    await runtime.dispose();
  });

  it("does not disconnect a replacement view after an offline release finishes", async () => {
    let resolveClose: (() => void) | undefined;
    let sends = 0;
    let session = 0;
    let onConnectionUpdate: RemoteTeamPeerActions["onConnectionUpdate"] | undefined;
    peer.sendHostStreamData.mockImplementation(async () => {
      sends += 1;
      if (sends === 2) await new Promise<void>((resolve) => (resolveClose = resolve));
    });
    peer.execute.mockImplementation(async (command) => {
      if (command.path === "/v1/compatibility") {
        return {
          ok: true,
          status: 200,
          body: { appVersion: "0.1.0", protocol: { minimum: 1, maximum: 4 }, capabilities: ["browser-view"] },
        };
      }
      if (command.method === "POST" && command.path === "/v1/browser/view/sessions") {
        session += 1;
        return {
          ok: true,
          status: 200,
          body: {
            id: `view-${session}`,
            tabId: String(command.body.tabId),
            streamPath: `/v1/browser/view/sessions/view-${session}/stream`,
          },
        };
      }
      return { ok: true, status: 200, body: {} };
    });
    const runtime = createWebWorkspaceRuntime(
      "one",
      { connection: vi.fn(), event: vi.fn(), accountChanged: async () => {} },
      vi.fn(),
      {
        createPeer: (actions: { current: RemoteTeamPeerActions }) => {
          onConnectionUpdate = actions.current.onConnectionUpdate;
          return peer;
        },
        acquireHostLock: async () => () => {},
      },
    );
    await runtime.connect(host);
    await runtime.browser.startLiveView("tab-one");

    await onConnectionUpdate?.({ hostId: host.hostId, state: "offline", message: "lost" });
    await vi.waitFor(() => expect(sends).toBe(2));
    const replacement = runtime.browser.startLiveView("tab-two");
    await vi.waitFor(() => expect(sends).toBe(3));
    resolveClose?.();
    await replacement;
    await vi.waitFor(() =>
      expect(peer.execute).toHaveBeenCalledWith(
        expect.objectContaining({ type: "request", method: "DELETE", path: "/v1/browser/view/sessions/view-1" }),
      ),
    );
    await runtime.browser.stopLiveView();
    expect(peer.execute).toHaveBeenCalledWith(
      expect.objectContaining({ type: "request", method: "DELETE", path: "/v1/browser/view/sessions/view-2" }),
    );
    await runtime.dispose();
  });
});
