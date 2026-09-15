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
  loadQueue: vi.fn<(agentId: string) => Promise<QueueSnapshot>>(),
  editQueue: vi.fn<(agentId: string, serverId: string, input: QueueEditRequest) => Promise<QueueSnapshot>>(),
  changeQueue: vi.fn(),
  uploadAttachment: vi.fn(),
  discardAttachment: vi.fn(),
  canEditQueue: () => true,
}));
vi.mock("expo-secure-store", () => ({
  getItem: (key: string) => boundary.storage.get(key) ?? null,
  setItem: (key: string, value: string) => boundary.storage.set(key, value),
  deleteItemAsync: async (key: string) => {
    boundary.storage.delete(key);
  },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "edit-phone" }));
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
    editId: "edit-phone",
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
      editId: "edit-phone",
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
