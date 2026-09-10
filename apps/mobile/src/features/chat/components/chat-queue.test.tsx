import { fireEvent, screen } from "@testing-library/dom";
import { act, type PropsWithChildren, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ChatMessage } from "../model/chat-messages";
import { ChatQueue } from "./chat-queue";
import type { ChatAttachment } from "./use-chat-attachments";
import { useQueueEdit } from "./use-queue-edit";

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
  const confirmation = Promise.withResolvers<Pick<typeof message, "body" | "attachments">>();
  const take = vi.fn(async (_message: typeof message) => confirmation.promise);
  take.mockRejectedValueOnce(new Error("Host unavailable"));
  function Composer() {
    const [available, setAvailable] = useState(true);
    const [draft, setDraft] = useState("Unsent draft");
    const [items, setItems] = useState<ChatAttachment[]>([
      { id: "local-file", name: "draft.txt", mimeType: "text/plain", base64: "YQ==", size: 1 },
    ]);
    const editor = useQueueEdit(
      draft,
      setDraft,
      { items, replace: setItems, clear: () => setItems([]) },
      async (queued) => {
        const prepared = await take(queued);
        setAvailable(false);
        return prepared;
      },
    );
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
  await act(async () => confirmation.resolve({ body: message.body, attachments: [] }));
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
