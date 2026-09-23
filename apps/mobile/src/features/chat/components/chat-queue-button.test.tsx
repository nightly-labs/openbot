import type { QueueDelivery } from "@openbot/contracts/ipc";
import { fireEvent, screen } from "@testing-library/dom";
import { act, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ChatQueueButton } from "./chat-queue-button";
import type { ChatQueueController } from "./use-chat-queue";

const native = vi.hoisted(() => ({ push: vi.fn(), selection: vi.fn(async () => {}) }));
vi.mock("expo-router", () => ({ router: { push: native.push } }));
vi.mock("@/shared/lib/haptics", () => ({ haptics: { selection: native.selection } }));
vi.mock("expo-glass-effect", () => ({ GlassView: ({ children }: PropsWithChildren) => <div>{children}</div> }));
vi.mock("react-native-reanimated", () => ({
  default: { View: ({ children }: PropsWithChildren) => <div>{children}</div> },
  cubicBezier: () => "ease-out",
}));
vi.mock("lucide-react-native", () => ({ ChevronUp: () => null, Clock: () => null, TriangleAlert: () => null }));
vi.mock("heroui-native/hooks", () => ({ useThemeColor: () => "gray" }));
vi.mock("heroui-native", () => {
  const Text = ({ children }: PropsWithChildren) => <span>{children}</span>;
  return { Typography: Object.assign(Text, { Paragraph: Text }) };
});
vi.mock("react-native", () => ({
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Pressable: ({
    children,
    accessibilityLabel,
    disabled,
    onPress,
  }: PropsWithChildren<{ accessibilityLabel: string; disabled?: boolean; onPress: () => void }>) => (
    <button type="button" aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.clearAllMocks();
});

const first: QueueDelivery = {
  id: "one",
  messageId: "message-one",
  recipientAgentId: "agent",
  sender: { kind: "user" },
  text: "First request",
  attachments: [],
  replyToMessageId: null,
  status: "queued",
  position: 1,
  turnId: null,
  error: null,
  createdAt: "2026-09-15T00:00:00Z",
};

function stubQueue(
  queued: QueueDelivery[],
  error: string | null = null,
  edit: ChatQueueController["edit"] = null,
): ChatQueueController {
  return {
    chatId: "host:agent",
    agentId: "agent",
    serverId: "host",
    attachments: [],
    changeAttachments: async () => {},
    attachmentSupport: () => ({ eml: true, media: true }),
    queued,
    deliveries: queued,
    edit,
    editUnavailable: false,
    confirmed: false,
    busy: false,
    progress: null,
    error,
    loading: false,
    canEdit: true,
    online: true,
    activeTurnId: "turn",
    begin: vi.fn(async () => {}),
    save: vi.fn(async () => true),
    refresh: vi.fn(),
    changeText: vi.fn(),
    removeAttachment: vi.fn(),
    cancelUpload: vi.fn(),
    cancelEdit: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    steer: vi.fn(async () => true),
    moveFirst: vi.fn(async () => true),
    discardFinishedEdit: vi.fn(async () => true),
  };
}

function mount(queue: ChatQueueController, pendingBody?: string) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ChatQueueButton
        queue={queue}
        pending={
          pendingBody === undefined
            ? undefined
            : {
                message: {
                  id: "local",
                  kind: "message",
                  author: "user",
                  body: pendingBody,
                  streaming: false,
                  replyToMessageId: null,
                  attachments: [],
                },
                progress: 0,
                total: 1,
                cancel: () => {},
              }
        }
        liquidGlassAvailable={false}
        fallbackBackground="white"
      />,
    ),
  );
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
}

it("renders nothing when the queue is empty", () => {
  mount(stubQueue([]));
  expect(screen.queryByRole("button")).toBeNull();
});

it("shows the queued count and opens the sheet on press", () => {
  const queued = [first, { ...first, id: "two", messageId: "message-two", text: "Second request", position: 2 }];
  mount(stubQueue(queued));
  const button = screen.getByRole("button", { name: "2 queued messages. Show queued messages" });
  expect(button.textContent).toContain("2 queued");
  act(() => fireEvent.click(button));
  expect(native.selection).toHaveBeenCalled();
  expect(native.push).toHaveBeenCalledWith({ pathname: "/queued-messages", params: { chat: "host:agent" } });
});

it("counts an uploading message toward the badge", () => {
  mount(stubQueue([first]), "Uploading now");
  expect(screen.getByRole("button", { name: "2 queued messages. Show queued messages" })).toBeTruthy();
});

it("keeps the entry reachable when the queue did not load", () => {
  // A failed load reports no messages. Without the entry, the failure and its retry would
  // stay hidden behind a button the chat never shows.
  mount(stubQueue([], "Could not load the queue."));
  const button = screen.getByRole("button", { name: "The queued messages did not load. Show queued messages" });
  expect(button.textContent).toContain("Queue unavailable");
  act(() => fireEvent.click(button));
  expect(native.push).toHaveBeenCalledWith({ pathname: "/queued-messages", params: { chat: "host:agent" } });
});

it("counts a held edit whose delivery is missing from the queue", () => {
  // A lost Save response can leave the host queue empty while the phone restores its
  // pending edit. The button must stay, so the saved edit stays reachable.
  const held = {
    editId: "edit-held",
    initialized: true,
    delivery: first,
    text: first.text,
    keepAttachmentIds: [],
    addedAttachments: [],
  };
  mount(stubQueue([], null, held));
  expect(screen.getByRole("button", { name: "1 queued message. Show queued messages" })).toBeTruthy();
});
