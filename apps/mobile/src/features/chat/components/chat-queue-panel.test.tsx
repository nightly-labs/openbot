import type { QueueDelivery } from "@openbot/contracts/ipc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ChatQueuePanel } from "./chat-queue-panel";
import type { ChatQueueController } from "./use-chat-queue";

const native = vi.hoisted(() => ({ thumbnail: vi.fn(async () => null), image: vi.fn() }));
vi.mock("@/features/workspace/context/mobile-workspace-context", () => ({
  useMobileWorkspace: () => ({ loadAttachmentThumbnail: native.thumbnail }),
}));
vi.mock("@expo/ui/community/menu", () => ({ MenuView: ({ children }: PropsWithChildren) => <div>{children}</div> }));
vi.mock("expo-glass-effect", () => ({ GlassView: ({ children }: PropsWithChildren) => <div>{children}</div> }));
vi.mock("expo-image", () => ({
  Image: ({ source }: { source: string }) => {
    native.image(source);
    return null;
  },
}));
vi.mock("lucide-react-native", () => ({
  ChevronDown: () => null,
  CornerDownRight: () => null,
  FileText: () => null,
  ImageIcon: () => null,
  ListOrdered: () => null,
  Pencil: () => null,
  Trash2: () => null,
  X: () => null,
}));
vi.mock("heroui-native/hooks", () => ({ useThemeColor: () => ["gray", "white"] }));
vi.mock("heroui-native", () => {
  const Label = ({ children }: PropsWithChildren) => <span>{children}</span>;
  return {
    Typography: Object.assign(Label, { Paragraph: Label }),
    Button: Object.assign(
      ({
        children,
        accessibilityLabel,
        accessibilityState,
        isDisabled,
        onPress,
      }: PropsWithChildren<{
        accessibilityLabel?: string;
        accessibilityState?: { expanded?: boolean };
        isDisabled?: boolean;
        onPress?: () => void;
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
      { Label },
    ),
  };
});
vi.mock("react-native", () => ({
  View: ({ children, accessibilityElementsHidden }: PropsWithChildren<{ accessibilityElementsHidden?: boolean }>) => (
    <div aria-hidden={accessibilityElementsHidden}>{children}</div>
  ),
  useWindowDimensions: () => ({ height: 800, fontScale: 1 }),
  FlatList: ({
    data,
    renderItem,
  }: {
    data: QueueDelivery[];
    renderItem: (input: { item: QueueDelivery }) => React.ReactNode;
  }) => (
    <div>
      {data.map((item) => (
        <div key={item.id}>{renderItem({ item })}</div>
      ))}
    </div>
  ),
}));
vi.mock("react-native-reanimated", () => {
  const transition = { duration: () => transition, easing: () => transition, reduceMotion: () => transition };
  return {
    default: {
      View: ({
        children,
        accessibilityElementsHidden,
      }: PropsWithChildren<{ accessibilityElementsHidden?: boolean }>) => (
        <div aria-hidden={accessibilityElementsHidden}>{children}</div>
      ),
      createAnimatedComponent: (component: React.ComponentType<PropsWithChildren>) => component,
    },
    Easing: { bezier: () => undefined },
    cubicBezier: () => undefined,
    FadeIn: transition,
    FadeOut: transition,
    LinearTransition: transition,
    ReduceMotion: { System: "system" },
    useReducedMotion: () => true,
  };
});
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
function mount(overrides: Partial<ChatQueueController> = {}) {
  const queued = [first, { ...first, id: "two", messageId: "message-two", text: "Second request", position: 2 }];
  const queue: ChatQueueController = {
    serverId: "host",
    attachments: [],
    changeAttachments: async () => {},
    queued,
    deliveries: queued,
    edit: null,
    editUnavailable: false,
    confirmed: false,
    busy: false,
    progress: null,
    error: null,
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
    ...overrides,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient();
  const render = () =>
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <ChatQueuePanel queue={queue} liquidGlassAvailable={false} fallbackBackground="white" />
        </QueryClientProvider>,
      ),
    );
  render();
  cleanups.push(() => {
    act(() => root.unmount());
    client.clear();
    container.remove();
  });
  return { queue, render, client };
}
it("keeps collapse accessible, restores row actions and sends the selected delivery to each action", () => {
  const view = mount();
  const toggle = screen.getByRole("button", { name: "2 queued messages" });
  act(() => fireEvent.click(toggle));
  expect(screen.getByRole("button", { name: "2 queued messages", expanded: false })).toBe(toggle);
  expect(screen.queryByRole("button", { name: "Edit message 1" })).toBeNull();
  view.render();
  expect(screen.getByRole("button", { name: "2 queued messages", expanded: false })).toBe(toggle);
  act(() => fireEvent.click(toggle));
  act(() => fireEvent.click(toggle));
  act(() => fireEvent.click(toggle));
  expect(screen.getByRole("button", { name: "2 queued messages", expanded: true })).toBe(toggle);
  act(() => fireEvent.click(screen.getByRole("button", { name: "Edit message 1" })));
  act(() => fireEvent.click(screen.getByRole("button", { name: "Steer message 1" })));
  act(() => fireEvent.click(screen.getByRole("button", { name: "Delete message 1" })));
  expect(view.queue.begin).toHaveBeenCalledWith(first);
  expect(view.queue.steer).toHaveBeenCalledWith(first);
  expect(view.queue.remove).toHaveBeenCalledWith(first);
  expect(native.thumbnail).not.toHaveBeenCalled();
});
it("shows only a text Close edit when the queued message is gone", () => {
  const view = mount({
    edit: {
      editId: "edit-1",
      initialized: true,
      delivery: first,
      text: "First request",
      keepAttachmentIds: [],
      addedAttachments: [],
    },
    editUnavailable: true,
  });
  expect(screen.getByText("This message is no longer queued")).toBeTruthy();
  const close = screen.getByRole("button", { name: "Close edit" });
  expect(screen.queryByRole("button", { name: "Cancel queue edit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Resume edit" })).toBeNull();
  act(() => fireEvent.click(close));
  expect(view.queue.discardFinishedEdit).toHaveBeenCalled();
});

it("observes cached queue attachments without a missing query function error or a full-file fetch", async () => {
  const error = vi.spyOn(console, "error");
  try {
    const file = {
      id: "image-1",
      name: "photo.png",
      mimeType: "image/png",
      size: 3,
      kind: "image" as const,
      previewKind: "image" as const,
      previewUrl: null,
    };
    const view = mount({ queued: [{ ...first, attachments: [file] }] });
    await waitFor(() => expect(native.thumbnail).toHaveBeenCalledWith("host", file.id));
    const key = ["chat-attachment", "host", file.id];
    expect(view.client.getQueryState(key)?.fetchStatus).toBe("idle");
    act(() =>
      view.client.setQueryData(key, {
        name: file.name,
        mimeType: file.mimeType,
        base64: "YWJj",
        localUri: "file:///photo.png",
      }),
    );
    await waitFor(() => expect(native.image).toHaveBeenCalledWith("file:///photo.png"));
    expect(
      error.mock.calls.some((args) =>
        args.some((value) => typeof value === "string" && value.includes("No queryFn was passed")),
      ),
    ).toBe(false);
  } finally {
    error.mockRestore();
  }
});
