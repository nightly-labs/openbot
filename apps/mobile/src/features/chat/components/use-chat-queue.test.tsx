import type { QueueDelivery, QueueSnapshot } from "@openbot/contracts/ipc";
import type { QueueEditRequest } from "@openbot/contracts/team-protocol/queue-edit-v1";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { waitFor } from "@testing-library/dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useChatQueue } from "./use-chat-queue";

const boundary = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  files: new Map<string, string>(),
  writeFile: vi.fn<(uri: string, bytes: string) => Promise<void>>(),
  sequence: 0,
  failStorage: false,
  loadQueue: vi.fn<(agentId: string) => Promise<QueueSnapshot>>(),
  editQueue: vi.fn<(agentId: string, serverId: string, input: QueueEditRequest) => Promise<QueueSnapshot>>(),
  changeQueue: vi.fn(),
  uploadAttachment: vi.fn(),
  discardAttachment: vi.fn(),
  canEditQueue: () => true,
}));
vi.mock("expo-secure-store", () => ({
  getItem: (key: string) => boundary.storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (boundary.failStorage) throw new Error("Storage unavailable");
    boundary.storage.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    boundary.storage.delete(key);
  },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => `edit-phone-${++boundary.sequence}` }));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  EncodingType: { Base64: "base64" },
  makeDirectoryAsync: async () => {},
  writeAsStringAsync: (uri: string, bytes: string) => boundary.writeFile(uri, bytes),
  readAsStringAsync: async (uri: string) => {
    const bytes = boundary.files.get(uri);
    if (bytes === undefined) throw new Error("Missing attachment");
    return bytes;
  },
  deleteAsync: async (uri: string) => {
    boundary.files.delete(uri);
  },
}));
vi.mock("@/features/auth/context/mobile-session-context", () => ({
  useMobileSession: () => ({ session: { user: { id: "member" } } }),
}));
vi.mock("@/features/workspace/context/mobile-workspace-context", () => ({ useMobileWorkspace: () => boundary }));

const delivery: QueueDelivery = {
  id: "delivery",
  messageId: "message",
  recipientAgentId: "agent",
  sender: { kind: "user" },
  text: "Original",
  attachments: [],
  replyToMessageId: null,
  status: "queued",
  position: 1,
  turnId: null,
  error: null,
  createdAt: "2026-09-15T00:00:00Z",
};
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  boundary.storage.clear();
  boundary.files.clear();
  boundary.writeFile.mockImplementation(async (uri, bytes) => {
    boundary.files.set(uri, bytes);
  });
  boundary.sequence = 0;
  boundary.failStorage = false;
  boundary.loadQueue.mockResolvedValue({ agentId: "agent", deliveries: [delivery] });
  boundary.editQueue.mockResolvedValue({ agentId: "agent", deliveries: [delivery] });
  boundary.changeQueue.mockResolvedValue(undefined);
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const root = createRoot(document.createElement("div"));
  let current: ReturnType<typeof useChatQueue> | undefined;
  function Harness() {
    current = useChatQueue("agent", "host", true, "turn-1");
    return null;
  }
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
  const close = () => act(() => root.unmount());
  cleanups.push(close);
  return {
    client,
    close,
    state: () => {
      if (!current) throw new Error("Not mounted");
      return current;
    },
  };
}
it("requires the durable host hold before save, keeps the draft after an error, then saves exactly once", async () => {
  let confirm = () => {};
  boundary.editQueue.mockImplementationOnce(async (_agent, _server, input) => {
    expect(boundary.storage.size).toBe(1);
    expect(input.action).toBe("begin");
    await new Promise<void>((resolve) => {
      confirm = resolve;
    });
    return { agentId: "agent", deliveries: [delivery] };
  });
  const view = mount();
  let beginning: Promise<void> | undefined;
  act(() => {
    beginning = view.state().begin(delivery);
  });
  expect(view.state().confirmed).toBe(false);
  await act(async () => {
    expect(await view.state().save("Too early", [])).toBe(false);
  });
  expect(boundary.editQueue).toHaveBeenCalledTimes(1);
  await act(async () => {
    confirm();
    await beginning;
  });
  expect(view.state().confirmed).toBe(true);
  act(() => view.state().changeText("Changed"));
  boundary.editQueue.mockRejectedValueOnce(new Error("Connection lost"));
  await act(async () => {
    expect(await view.state().save("Changed", [])).toBe(false);
  });
  expect(view.state().edit?.text).toBe("Changed");
  await act(async () => {
    const first = view.state().save("Changed", []);
    expect(await view.state().save("Duplicate", [])).toBe(false);
    expect(await first).toBe(true);
  });
  expect(boundary.editQueue.mock.calls.map((call) => call[2].action)).toEqual(["begin", "save", "save"]);
  expect(view.state().edit).toBeNull();
  expect(boundary.storage.size).toBe(0);
});
it("keeps edit identity and text on navigation and never releases a hold on unmount", async () => {
  const view = mount();
  await act(async () => {
    await view.state().begin(delivery);
  });
  act(() => view.state().changeText("Work in progress"));
  cleanups.pop();
  view.close();
  expect(boundary.editQueue.mock.calls.map((call) => call[2].action)).toEqual(["begin"]);
  const restored = mount(view.client);
  expect(restored.state().edit?.text).toBe("Work in progress");
  expect(restored.state().confirmed).toBe(false);
  await act(async () => {
    await restored.state().begin(delivery);
  });
  expect(boundary.editQueue.mock.calls[1][2]).toEqual({
    action: "begin",
    deliveryId: delivery.id,
    editId: "edit-phone-1",
  });
  await act(async () => {
    await restored.state().cancelEdit();
  });
  expect(restored.state().edit).toBeNull();
});
it("keeps the finished notice hidden while an edit request is in flight", async () => {
  boundary.storage.set(
    "queue-edit.member.host.agent",
    JSON.stringify({
      editId: "edit-phone-1",
      initialized: true,
      delivery,
      text: "Work in progress",
      keepAttachmentIds: [],
    }),
  );
  boundary.loadQueue
    .mockResolvedValueOnce({ agentId: "agent", deliveries: [{ ...delivery, status: "running", position: null }] })
    .mockResolvedValue({ agentId: "agent", deliveries: [delivery] });
  let release = () => {};
  boundary.editQueue.mockImplementationOnce(
    () =>
      new Promise<QueueSnapshot>((resolve) => {
        release = () => resolve({ agentId: "agent", deliveries: [delivery] });
      }),
  );
  const view = mount();
  await waitFor(() => expect(view.state().editUnavailable).toBe(true));
  act(() => {
    void view.state().begin(delivery);
  });
  expect(view.state().busy).toBe(true);
  expect(view.state().editUnavailable).toBe(false);
  await act(async () => {
    release();
  });
  await waitFor(() => expect(view.state().confirmed).toBe(true));
  await waitFor(() => expect(view.state().editUnavailable).toBe(false));
});
it("routes steer, delete and reorder to the original host and expected turn", async () => {
  const view = mount();
  await waitFor(() => expect(view.state().queued).toHaveLength(1));
  await act(async () => {
    await view.state().steer(delivery);
  });
  expect(boundary.changeQueue).toHaveBeenLastCalledWith("agent", "host", "steer", {
    deliveryId: delivery.id,
    expectedTurnId: "turn-1",
  });
  await act(async () => {
    await view.state().moveFirst(delivery);
  });
  expect(boundary.changeQueue).toHaveBeenLastCalledWith("agent", "host", "reorder", { deliveryIds: [delivery.id] });
  await act(async () => {
    await view.state().remove(delivery);
  });
  expect(boundary.changeQueue).toHaveBeenLastCalledWith("agent", "host", "cancel", { deliveryId: delivery.id });
});

it("clears a rejected begin but preserves an uncertain begin for recovery", async () => {
  const { QueueEditRejectedError } = await import("@openbot/contracts/team-protocol/queue-edit-v1");
  boundary.editQueue.mockRejectedValueOnce(new QueueEditRejectedError("Already held"));
  const view = mount();
  await act(async () => {
    await view.state().begin(delivery);
  });
  expect(view.state().edit).toBeNull();
  expect(boundary.storage.size).toBe(0);
  boundary.editQueue.mockRejectedValueOnce(new Error("Connection lost"));
  await act(async () => {
    await view.state().begin(delivery);
  });
  expect(view.state().edit?.delivery.id).toBe(delivery.id);
  expect(boundary.storage.size).toBe(1);
});

const pastedFiles = [
  { id: "image", name: "pasted-image.png", mimeType: "image/png", size: 3, base64: "YWJj" },
  { id: "text", name: "pasted-text.txt", mimeType: "text/plain", size: 3, base64: "ZGVm" },
];
it("keeps an over-limit edit recoverable and saves after a retained attachment is removed", async () => {
  const fullDelivery: QueueDelivery = {
    ...delivery,
    attachments: Array.from({ length: 10 }, (_, index) => ({
      id: `file-${index}`,
      name: `file-${index}.txt`,
      mimeType: "text/plain",
      size: 3,
      kind: "file",
      previewKind: "none",
      previewUrl: null,
    })),
  };
  const snapshot = { agentId: "agent", deliveries: [fullDelivery] };
  boundary.loadQueue.mockResolvedValue(snapshot);
  boundary.editQueue.mockResolvedValue(snapshot);
  const view = mount();
  await act(async () => {
    await view.state().begin(fullDelivery);
    await view.state().changeAttachments(pastedFiles.slice(0, 1));
  });
  await act(async () => {
    expect(await view.state().save("Changed", view.state().attachments)).toBe(false);
  });
  expect(view.state().error).toBe("You can attach up to 10 files.");
  expect(view.state().edit?.pendingSave).toBeUndefined();
  expect(boundary.uploadAttachment).not.toHaveBeenCalled();
  expect(boundary.editQueue.mock.calls.map((call) => call[2].action)).toEqual(["begin"]);
  cleanups.pop();
  view.close();
  const restored = mount();
  expect(restored.state().edit?.keepAttachmentIds).toHaveLength(10);
  expect(restored.state().attachments).toHaveLength(1);
  await act(async () => {
    await restored.state().begin(fullDelivery);
  });
  act(() => restored.state().removeAttachment("file-0"));
  expect(restored.state().edit?.keepAttachmentIds).toHaveLength(9);
  boundary.uploadAttachment.mockResolvedValue({ id: "uploaded-image" });
  await act(async () => {
    expect(await restored.state().save("Changed", restored.state().attachments)).toBe(true);
  });
  expect(boundary.editQueue).toHaveBeenLastCalledWith("agent", "host", {
    action: "save",
    deliveryId: delivery.id,
    editId: "edit-phone-1",
    text: "Changed",
    keepAttachmentIds: fullDelivery.attachments.slice(1).map((file) => file.id),
    attachmentDraftIds: ["uploaded-image"],
  });
  expect(restored.state().edit).toBeNull();
  expect(boundary.storage.size).toBe(0);
});
it("restores added image and text bytes after a fresh query cache and sends them once", async () => {
  const first = mount();
  await act(async () => {
    await first.state().begin(delivery);
    await first.state().changeAttachments(pastedFiles);
  });
  expect(boundary.storage.values().next().value).not.toContain("YWJj");
  first.close();
  const restored = mount();
  expect(restored.state().attachments.map((file) => file.name)).toEqual(pastedFiles.map((file) => file.name));
  boundary.uploadAttachment.mockImplementation(async (_agent, file) => ({ id: `uploaded-${file.name}` }));
  await act(async () => {
    await restored.state().begin(delivery);
  });
  await act(async () => {
    expect(await restored.state().save("Saved", restored.state().attachments)).toBe(true);
  });
  expect(boundary.uploadAttachment.mock.calls.map((call) => call[1].base64)).toEqual(["YWJj", "ZGVm"]);
  expect(boundary.editQueue.mock.calls.filter((call) => call[2].action === "save")).toHaveLength(1);
  expect(boundary.files.size).toBe(0);
  expect(boundary.storage.size).toBe(0);
});
it("keeps attachments locked after an uncertain save until cancellation", async () => {
  const view = mount();
  await act(async () => {
    await view.state().begin(delivery);
    await view.state().changeAttachments(pastedFiles);
  });
  boundary.uploadAttachment.mockResolvedValue({ id: "uploaded" });
  boundary.editQueue.mockResolvedValueOnce({ agentId: "agent", deliveries: [delivery] });
  boundary.editQueue.mockRejectedValueOnce(new Error("Disconnected"));
  await act(async () => {
    expect(await view.state().save("Retry", view.state().attachments)).toBe(false);
  });
  expect(boundary.files.size).toBe(2);
  await act(async () => {
    await expect(view.state().changeAttachments(view.state().attachments.slice(1))).rejects.toThrow("busy");
  });
  expect([...boundary.files.values()]).toEqual(["YWJj", "ZGVm"]);
  await act(async () => {
    await view.state().cancelEdit();
  });
  expect(boundary.files.size).toBe(0);
});
it("does not accept an attachment whose bytes could not be saved", async () => {
  const view = mount();
  await act(async () => {
    await view.state().begin(delivery);
  });
  boundary.writeFile.mockRejectedValueOnce(new Error("Disk full"));
  await act(async () => {
    await expect(view.state().changeAttachments(pastedFiles)).rejects.toThrow("Disk full");
  });
  expect(view.state().attachments).toEqual([]);
  expect(boundary.files.size).toBe(0);
  expect(view.state().busy).toBe(false);
});

it("rolls back new attachment files when saving their references fails", async () => {
  const view = mount();
  await act(async () => {
    await view.state().begin(delivery);
    await view.state().changeAttachments(pastedFiles.slice(0, 1));
  });
  boundary.failStorage = true;
  await act(async () => {
    await expect(view.state().changeAttachments(pastedFiles)).rejects.toThrow("Storage unavailable");
  });
  boundary.failStorage = false;
  expect(view.state().attachments.map((file) => file.id)).toEqual(["image"]);
  expect([...boundary.files.values()]).toEqual(["YWJj"]);
});

it("reuses the durable save request and uploads only once after lost responses and a restart", async () => {
  const view = mount();
  await act(async () => {
    await view.state().begin(delivery);
    await view.state().changeAttachments(pastedFiles);
  });
  boundary.uploadAttachment.mockImplementation(async (_agent, file) => ({ id: `uploaded-${file.id}` }));
  let submitted: QueueEditRequest | undefined;
  boundary.editQueue.mockImplementation(async (_agent, _server, input) => {
    if (input.action === "retain-attachments") return { agentId: "agent", deliveries: [delivery] };
    expect(input.action).toBe("save");
    expect(JSON.parse(boundary.storage.get("queue-edit.member.host.agent") ?? "{}").pendingSave).toEqual(input);
    if (submitted) expect(input).toEqual(submitted);
    submitted = input;
    throw new Error("Response lost");
  });
  await act(async () => {
    expect(await view.state().save("Saved text", view.state().attachments)).toBe(false);
  });
  act(() => view.state().changeText("Must not replace the pending save"));
  expect(view.state().edit?.text).toBe("Saved text");
  await act(async () => {
    expect(await view.state().save("Different argument", [])).toBe(false);
  });
  expect(boundary.uploadAttachment).toHaveBeenCalledTimes(2);
  expect(boundary.discardAttachment).not.toHaveBeenCalled();
  cleanups.pop();
  view.close();
  const restored = mount();
  expect(restored.state().confirmed).toBe(true);
  expect(restored.state().edit?.pendingSave).toEqual(submitted);
  await act(async () => {
    await restored.state().begin(delivery);
  });
  boundary.editQueue.mockImplementation(async (_agent, _server, input) => {
    expect(input).toEqual(submitted);
    return { agentId: "agent", deliveries: [delivery] };
  });
  await act(async () => {
    expect(await restored.state().save("Saved text", restored.state().attachments)).toBe(true);
  });
  expect(boundary.uploadAttachment).toHaveBeenCalledTimes(2);
  expect(boundary.editQueue.mock.calls.map((call) => call[2].action)).toEqual([
    "begin",
    "retain-attachments",
    "save",
    "save",
    "save",
  ]);
  expect(restored.state().edit).toBeNull();
  expect(boundary.storage.size).toBe(0);
  expect(boundary.files.size).toBe(0);
});

it("does not send Save if its request cannot be persisted and removes the unused uploads", async () => {
  const view = mount();
  await act(async () => {
    await view.state().begin(delivery);
  });
  boundary.uploadAttachment.mockResolvedValue({ id: "unused-upload" });
  boundary.failStorage = true;
  await act(async () => {
    expect(await view.state().save("Text", pastedFiles.slice(0, 1))).toBe(false);
  });
  expect(boundary.editQueue.mock.calls.map((call) => call[2].action)).toEqual(["begin", "retain-attachments"]);
  expect(boundary.discardAttachment).toHaveBeenCalledWith("agent", "unused-upload", "host");
  expect(view.state().edit?.pendingSave).toBeUndefined();
  boundary.failStorage = false;
});
