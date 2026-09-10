import type { QueueEditInput, QueueEditState } from "@openbot/contracts/ipc";
import { QueueEditSession } from "@openbot/team-client/queue-edit-session";
import { fireEvent, screen } from "@testing-library/dom";
import { act, type PropsWithChildren, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { type ChatMessage, projectChatMessages } from "../model/chat-messages";
import {
  discardQueueEdit,
  type PreparedQueueEdit,
  prepareQueueEdit,
  recoverQueueEdit,
  saveQueueEdit,
} from "../model/queue-edit-operations";
import { createQueueEditStore } from "../model/queue-edit-store";
import { ChatQueue } from "./chat-queue";
import { useQueueEdit } from "./use-queue-edit";

function testSession() {
  return new QueueEditSession(
    "agent",
    { deliveryId: "delivery", revision: 1, text: "Queued task", attachments: [], replyToMessageId: null },
    async () => null,
  );
}

// Native layout and text have no DOM implementation. Keep text available to accessibility queries.
vi.mock("react-native", () => ({
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  ScrollView: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("react-native-worklets", () => ({
  scheduleOnRN: (callback: (value: boolean) => void, value: boolean) => callback(value),
}));
vi.mock("react-native-reanimated", () => ({
  default: {
    View: ({ children, accessibilityElementsHidden }: PropsWithChildren<{ accessibilityElementsHidden?: boolean }>) => (
      <div aria-hidden={accessibilityElementsHidden}>{children}</div>
    ),
  },
  useSharedValue: (initial: number) => ({ get: () => initial, set: () => {} }),
  useAnimatedStyle: (style: () => object) => style(),
  cancelAnimation: () => {},
  withTiming: (value: number, _config: object, complete: (finished: boolean) => void) => {
    complete(true);
    return value;
  },
  ReduceMotion: { System: "system" },
}));
vi.mock("expo-glass-effect", () => ({ GlassView: ({ children }: PropsWithChildren) => <div>{children}</div> }));
vi.mock("lucide-react-native", () => ({
  CornerDownRight: () => null,
  ChevronDown: () => null,
  ChevronUp: () => null,
  ListOrdered: () => null,
  Pencil: () => null,
  Trash2: () => null,
}));
vi.mock("heroui-native", () => ({
  Typography: { Paragraph: ({ children }: PropsWithChildren) => <p>{children}</p> },
  Button: ({
    children,
    onPress,
    accessibilityLabel,
    accessibilityState,
    isDisabled,
  }: PropsWithChildren<{
    onPress: () => void;
    accessibilityLabel: string;
    accessibilityState?: { expanded: boolean };
    isDisabled?: boolean;
  }>) => (
    <button
      type="button"
      aria-label={accessibilityLabel}
      aria-expanded={accessibilityState?.expanded}
      disabled={isDisabled}
      onClick={onPress}
    >
      {children}
    </button>
  ),
}));
const actions = { canManage: true, onEdit: vi.fn(), onDelete: vi.fn(async () => {}) };
const appearance = {
  canSteer: true,
  onSteer: vi.fn(async (_deliveryId: string) => {}),
  onAnimatingChange: vi.fn(),
  liquidGlassAvailable: true,
  fallbackBackground: "black",
  foreground: "white",
  muted: "gray",
};

const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(async () => {
  await act(() => root.unmount());
  root = createRoot(container);
});

it("shows queue state and attachments, then removes the queue when no messages are waiting", async () => {
  const messages: Extract<ChatMessage, { kind: "message" }>[] = [
    {
      id: "waiting",
      kind: "message",
      author: "user",
      body: "Next task",
      streaming: false,
      delivery: { id: "waiting", status: "queued", position: 1 },
      attachments: [
        {
          id: "file",
          name: "notes.txt",
          size: 5,
          kind: "file",
          mimeType: "text/plain",
          previewKind: "none",
          previewUrl: null,
        },
      ],
    },
    {
      id: "sending",
      kind: "message",
      author: "user",
      body: "Another task",
      streaming: false,
      awaitingQueueReceipt: true,
    },
  ];
  await act(() => root.render(<ChatQueue {...actions} {...appearance} messages={messages} />));
  expect(screen.queryByRole("button", { name: "Edit queued message 1" })).toBeNull();
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Expand 2 queued messages" })));
  expect(
    ["Up next", "2 queued", "Next task", "notes.txt", "Sending…", "Another task"].map(
      (text) => screen.getByText(text).textContent,
    ),
  ).toEqual(["Up next", "2 queued", "Next task", "notes.txt", "Sending…", "Another task"]);
  await act(() => root.render(<ChatQueue {...actions} {...appearance} messages={messages.slice(0, 1)} />));
  await act(() => root.render(<ChatQueue {...actions} {...appearance} messages={messages} />));
  expect(screen.getByRole("button", { name: "Collapse 2 queued messages" })).toBeTruthy();
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Collapse 2 queued messages" })));
  expect(screen.queryByRole("button", { name: "Edit queued message 1" })).toBeNull();
  await act(() => root.render(<ChatQueue {...actions} {...appearance} messages={[]} />));
  expect(screen.queryByText("Up next")).toBeNull();
});

it("passes the full message to the composer and deletes by host delivery ID", async () => {
  const message: Extract<ChatMessage, { kind: "message" }> = {
    id: "local-alias",
    kind: "message",
    author: "user",
    body: "Old text",
    streaming: false,
    delivery: { id: "host-delivery", status: "queued", position: 1 },
    attachments: [
      {
        id: "keep-file",
        name: "notes.txt",
        size: 5,
        kind: "file",
        mimeType: "text/plain",
        previewKind: "none",
        previewUrl: null,
      },
    ],
  };
  const onEdit = vi.fn();
  const onDelete = vi.fn(async (_id: string) => {});
  await act(() =>
    root.render(<ChatQueue {...appearance} canManage messages={[message]} onEdit={onEdit} onDelete={onDelete} />),
  );
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Edit queued message 1" })));
  expect(onEdit).toHaveBeenCalledWith(message);
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Steer queued message 1" })));
  expect(appearance.onSteer).toHaveBeenCalledWith("host-delivery");
  await act(() =>
    root.render(
      <ChatQueue {...appearance} canManage canSteer={false} messages={[message]} onEdit={onEdit} onDelete={onDelete} />,
    ),
  );
  expect(screen.getByRole("button", { name: "Steer queued message 1" })).toHaveProperty("disabled", true);
  expect(screen.queryByRole("textbox")).toBeNull();
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Delete queued message 1" })));
  expect(onDelete).toHaveBeenCalledWith("host-delivery");
});

it("disables changes for messages that have started", async () => {
  const message: Extract<ChatMessage, { kind: "message" }> = {
    id: "local",
    kind: "message",
    author: "user",
    body: "Draft",
    streaming: false,
    delivery: { id: "delivery", status: "starting", position: 1 },
  };
  await act(() => root.render(<ChatQueue {...actions} {...appearance} messages={[message]} />));
  expect(screen.getByRole("button", { name: "Edit queued message 1" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Delete queued message 1" })).toHaveProperty("disabled", true);
});

it("loads a queued message into the composer and restores the previous draft on cancel", async () => {
  const message: Extract<ChatMessage, { kind: "message" }> = {
    id: "local",
    kind: "message",
    author: "user",
    body: "Queued task",
    streaming: false,
    delivery: { id: "host", status: "queued", position: 1 },
  };
  const confirmation = Promise.withResolvers<PreparedQueueEdit>();
  const take = vi.fn(async (_message: typeof message) => confirmation.promise);
  take.mockRejectedValueOnce(new Error("Host unavailable"));
  const store = createQueueEditStore();
  store.update(JSON.stringify(["server", "agent"]), {
    draft: "Unsent draft",
    items: [{ id: "local-file", name: "draft.txt", mimeType: "text/plain", base64: "YQ==", size: 1 }],
  });
  function Composer() {
    const [available, setAvailable] = useState(true);
    const editor = useQueueEdit(store, { serverId: "server", id: "agent" }, async (queued) => {
      const prepared = await take(queued);
      setAvailable(false);
      return prepared;
    });
    const { draft, setDraft, items } = editor;
    return (
      <>
        <ChatQueue {...appearance} {...actions} messages={available ? [message] : []} onEdit={editor.startQueueEdit} />
        <input aria-label="Message" value={draft} onChange={(event) => setDraft(event.target.value)} />
        {items.map((file) => (
          <p key={file.id}>{file.name}</p>
        ))}
        {editor.queueEdit ? (
          <button type="button" onClick={editor.finishQueueEdit}>
            Cancel edit
          </button>
        ) : null}
      </>
    );
  }
  await act(() => root.render(<Composer />));
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Edit queued message 1" })));
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveProperty("value", "Unsent draft");
  expect(screen.getByText("draft.txt")).toBeTruthy();
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Edit queued message 1" })));
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveProperty("value", "Unsent draft");
  await act(async () => confirmation.resolve({ body: message.body, attachments: [], session: testSession() }));
  expect(take).toHaveBeenLastCalledWith(message);
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveProperty("value", "Queued task");
  expect(screen.queryByText("Up next")).toBeNull();
  expect(screen.queryByText("draft.txt")).toBeNull();
  await act(() =>
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Revised task" } }),
  );
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Cancel edit" })));
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveProperty("value", "Unsent draft");
  expect(screen.getByText("draft.txt")).toBeTruthy();
  expect(screen.queryByText("Up next")).toBeNull();
});

it.each([false, true])("keeps a queued reply when navigation precedes take completion: %s", async (leaveBeforeTake) => {
  const store = createQueueEditStore();
  const scope = { serverId: "server-one", id: "agent" };
  const message = projectChatMessages([
    {
      id: "reply",
      author: "user",
      text: "Queued reply",
      createdAt: "2026-09-10T10:00:00Z",
      status: "completed",
      replyToMessageId: "original-message",
      delivery: { id: "delivery", status: "queued", position: 1 },
    },
  ])[0];
  if (message?.kind !== "message") throw new Error("Expected a queued reply");
  const queuedReply = message;
  const confirmation = Promise.withResolvers<PreparedQueueEdit>();
  const take = () => confirmation.promise;
  function Composer({ serverId = scope.serverId }: { serverId?: string }) {
    const editor = useQueueEdit(store, { ...scope, serverId }, take);
    return (
      <>
        <button type="button" onClick={() => void editor.startQueueEdit(queuedReply)}>
          Edit
        </button>
        <input aria-label="Message" value={editor.draft} onChange={(event) => editor.setDraft(event.target.value)} />
        {editor.queueEdit ? (
          <>
            <p>{editor.queueEdit.message.replyToMessageId}</p>
            {editor.queueEdit.message.attachments?.map((file) => (
              <p key={file.id}>{file.name}</p>
            ))}
            <button type="button" onClick={editor.finishQueueEdit}>
              Cancel edit
            </button>
          </>
        ) : null}
      </>
    );
  }
  await act(() => root.render(<Composer />));
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Edit" })));
  if (leaveBeforeTake) await act(() => root.render(null));
  await act(() =>
    confirmation.resolve({
      session: testSession(),
      body: message.body,
      attachments: [
        {
          id: "retained",
          name: "reply.txt",
          size: 1,
          kind: "file",
          mimeType: "text/plain",
          previewKind: "none",
          previewUrl: null,
        },
      ],
    }),
  );
  if (leaveBeforeTake) await act(() => root.render(<Composer />));
  await act(() =>
    fireEvent.input(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Changed reply" } }),
  );
  await act(() => root.render(null));
  await act(() => root.render(<Composer serverId="server-two" />));
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveProperty("value", "");
  await act(() => root.render(null));
  await act(() => root.render(<Composer />));
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveProperty("value", "Changed reply");
  expect(screen.getByText("original-message")).toBeTruthy();
  expect(screen.getByText("reply.txt")).toBeTruthy();
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Cancel edit" })));
  await act(() => root.render(null));
  await act(() => root.render(<Composer />));
  expect(screen.queryByRole("button", { name: "Cancel edit" })).toBeNull();
});

it.each([false, true])("locks an edited send across navigation and permits retry after failure: %s", async (fail) => {
  const store = createQueueEditStore();
  const completion = Promise.withResolvers<void>();
  const send = vi.fn(() => completion.promise);
  const message: Extract<ChatMessage, { kind: "message" }> = {
    id: "queued",
    kind: "message",
    author: "user",
    body: "Send once",
    streaming: false,
    delivery: { id: "delivery", status: "queued", position: 1 },
  };
  function Composer() {
    const editor = useQueueEdit(store, { serverId: "server", id: "agent" }, async () => ({
      ...message,
      attachments: message.attachments,
      session: testSession(),
    }));
    return (
      <>
        <button type="button" onClick={() => void editor.startQueueEdit(message)}>
          Edit
        </button>
        <input aria-label="Message" value={editor.draft} onChange={(event) => editor.setDraft(event.target.value)} />
        {editor.queueEdit ? (
          <>
            <button
              type="button"
              disabled={editor.sending}
              onClick={() => void editor.sendQueueEdit(send).catch(() => {})}
            >
              Send
            </button>
            <button type="button" onClick={editor.finishQueueEdit}>
              Cancel edit
            </button>
          </>
        ) : null}
      </>
    );
  }
  await act(() => root.render(<Composer />));
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Edit" })));
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Send" })));
  await act(() => root.render(null));
  await act(() => root.render(<Composer />));
  expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", true);
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Send" })));
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Cancel edit" })));
  await act(() =>
    fireEvent.input(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Unsafe replacement" } }),
  );
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveProperty("value", "Send once");
  expect(send).toHaveBeenCalledTimes(1);
  if (fail) {
    await act(() => completion.reject(new Error("Host unavailable")));
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveProperty("value", "Send once");
    send.mockResolvedValueOnce();
    await act(() => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(send).toHaveBeenCalledTimes(2);
  } else {
    await act(() => completion.resolve());
  }
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
});

it.each(["user", "agent", "routine"] as const)(
  "recovers and sends a held %s message through its original delivery",
  async (source) => {
    const hostFile = {
      id: "host-draft",
      name: "latest.txt",
      size: 1,
      kind: "file" as const,
      mimeType: "text/plain",
      previewKind: "none" as const,
      previewUrl: null,
    };
    const state: QueueEditState = {
      deliveryId: "delivery",
      revision: 2,
      text: "Latest host text",
      attachments: [hostFile],
      replyToMessageId: "reply",
    };
    const workspace = {
      queueEdit: vi.fn(async (input: QueueEditInput, _serverId: string) =>
        input.operation === "read" || input.operation === "begin"
          ? state
          : input.operation === "save"
            ? { ...state, revision: input.revision + 1, text: input.text }
            : null,
      ),
    };
    const agent = { id: "chief", serverId: "server" };
    const projected = projectChatMessages([
      {
        id: "delivery",
        author: source === "agent" ? "agent" : "user",
        source,
        text: "Original instructions",
        createdAt: "2026-09-10T10:00:00Z",
        status: "completed",
        delivery: { id: "delivery", status: "queued", position: 1 },
        ...(source === "agent"
          ? {
              exchange: {
                direction: "incoming" as const,
                messageId: "message",
                senderAgentId: "sales",
                recipientAgentIds: ["chief"],
                replyToMessageId: null,
                deliveries: [],
              },
            }
          : {}),
      },
    ]);
    const message = projected.find((item) => item.kind === "message");
    if (message?.kind !== "message") throw new Error("Missing queued message");
    expect(message.body).toBe("Original instructions");
    const prepared = await prepareQueueEdit(workspace, agent, message);
    expect(prepared.body).toBe("Latest host text");
    // A new workspace store represents a new app process, with no in-memory edit to recover.
    const store = createQueueEditStore();
    const recover = () => recoverQueueEdit(workspace, agent);
    function Composer() {
      const editor = useQueueEdit(store, agent, async () => prepared, recover);
      return <input aria-label="Recovered message" value={editor.draft} readOnly />;
    }
    await act(() => root.render(<Composer />));
    expect(screen.getByRole("textbox", { name: "Recovered message" })).toHaveProperty("value", "Latest host text");
    const recovered = await recover();
    if (!recovered) throw new Error("Missing recovery");
    await saveQueueEdit({ message: recovered.message, session: recovered.session }, "Revised", []);
    expect(workspace.queueEdit).toHaveBeenLastCalledWith(
      {
        agentId: "chief",
        deliveryId: "delivery",
        revision: 3,
        operation: "send",
        text: "Revised",
        attachmentDraftIds: ["host-draft"],
      },
      "server",
    );
    await discardQueueEdit({ message, session: prepared.session });
    expect(workspace.queueEdit).toHaveBeenLastCalledWith(
      { agentId: "chief", deliveryId: "delivery", revision: 2, operation: "cancel" },
      "server",
    );
  },
);
