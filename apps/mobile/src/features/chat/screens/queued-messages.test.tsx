import type { QueueDelivery } from "@openbot/contracts/ipc";
import { fireEvent, screen } from "@testing-library/dom";
import { act, type PropsWithChildren, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ChatQueueController } from "../components/use-chat-queue";
import type { QueuedUpload } from "../context/queued-messages-context";
import { QueuedMessageActionsScreen } from "./queued-message-actions-screen";
import { QueuedMessageEditScreen } from "./queued-message-edit-screen";
import { QueuedMessagesScreen } from "./queued-messages-screen";

const native = vi.hoisted(() => {
  const params: { deliveryId: string } = { deliveryId: "one" };
  const guard: { prevent: boolean; callback: ((event: { data: { action: string } }) => void) | null } = {
    prevent: false,
    callback: null,
  };
  const context: { queue: ChatQueueController | null; pending: QueuedUpload | null } = { queue: null, pending: null };
  return {
    push: vi.fn(),
    back: vi.fn(),
    alert: vi.fn(),
    selection: vi.fn(async () => {}),
    impact: vi.fn(async () => {}),
    notification: vi.fn(async () => {}),
    params,
    context,
    guard,
    dispatch: vi.fn(),
  };
});

vi.mock("expo-router", () => ({
  router: { push: native.push, back: native.back },
  useLocalSearchParams: () => native.params,
  useNavigation: () => ({ dispatch: native.dispatch }),
}));
vi.mock("expo-router/react-navigation", () => ({
  usePreventRemove: (prevent: boolean, callback: (event: { data: { action: string } }) => void) => {
    native.guard.prevent = prevent;
    native.guard.callback = callback;
  },
}));
vi.mock("../context/queued-messages-context", () => ({ useQueuedMessages: () => native.context }));
vi.mock("@/shared/lib/haptics", () => ({
  haptics: { selection: native.selection, impact: native.impact, notification: native.notification },
}));
vi.mock("heroui-native/hooks", () => ({ useThemeColor: () => "gray" }));
vi.mock("uniwind", () => ({ useCSSVariable: () => "red" }));
vi.mock("lucide-react-native", () => ({
  ArrowUpToLine: () => null,
  CornerDownRight: () => null,
  FileText: () => null,
  Pencil: () => null,
  Trash2: () => null,
  X: () => null,
}));
vi.mock("heroui-native", () => {
  const Text = ({ children }: PropsWithChildren) => <span>{children}</span>;
  const Button = ({
    children,
    accessibilityLabel,
    isDisabled,
    onPress,
  }: PropsWithChildren<{ accessibilityLabel?: string; isDisabled?: boolean; onPress?: () => void }>) => (
    <button type="button" aria-label={accessibilityLabel} disabled={isDisabled} onClick={onPress}>
      {children}
    </button>
  );
  return { Typography: Object.assign(Text, { Paragraph: Text }), Button: Object.assign(Button, { Label: Text }) };
});
vi.mock("react-native", () => ({
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Alert: { alert: native.alert },
}));
vi.mock("@/features/settings/components/settings-content", () => {
  const Row = ({
    children,
    leading,
    trailing,
    supportingText,
    onPress,
    disabled,
  }: PropsWithChildren<{
    leading?: ReactNode;
    trailing?: ReactNode;
    supportingText?: string;
    onPress?: () => void;
    disabled?: boolean;
  }>) => {
    const content = (
      <>
        {leading}
        {children}
        {supportingText ? <span>{supportingText}</span> : null}
      </>
    );
    return onPress ? (
      <>
        <button type="button" disabled={disabled} onClick={onPress}>
          {content}
        </button>
        {trailing}
      </>
    ) : (
      <div>
        {content}
        {trailing}
      </div>
    );
  };
  return {
    SettingsContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SettingsNote: ({ children }: PropsWithChildren) => <p>{children}</p>,
    SettingsSection: ({ title, children }: PropsWithChildren<{ title?: string }>) => (
      <section aria-label={title}>{children}</section>
    ),
    SettingsRow: Row,
  };
});
vi.mock("@/shared/components/sheet-form-field", () => ({
  SheetFormField: ({
    label,
    value,
    editable,
    onChangeText,
  }: {
    label: string;
    value: string;
    editable?: boolean;
    onChangeText: (value: string) => void;
  }) => (
    <textarea
      aria-label={label}
      value={value}
      disabled={editable === false}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
}));
vi.mock("@/shared/components/sheet-save-action", () => ({
  SheetSaveAction: ({
    label,
    dirty,
    canSave,
    pending,
    onSave,
  }: {
    label: string;
    dirty: boolean;
    canSave: boolean;
    pending: boolean;
    onSave: () => void;
  }) => (
    <button type="button" aria-label={label} disabled={!dirty || !canSave || pending} onClick={onSave}>
      {label}
    </button>
  ),
}));

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  native.context.queue = null;
  native.context.pending = null;
  native.params = { deliveryId: "one" };
  native.guard.prevent = false;
  native.guard.callback = null;
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
  createdAt: "2026-09-15T10:31:00Z",
};
const second: QueueDelivery = { ...first, id: "two", messageId: "message-two", text: "Second request", position: 2 };

function stubQueue(overrides: Partial<ChatQueueController> = {}): ChatQueueController {
  const queued = [first, second];
  return {
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
}

function mount(create: () => ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  // A fresh element each time: React bails out of re-rendering the identical node.
  const render = () => act(() => root.render(create()));
  render();
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { render };
}

it("lists the queue and opens the options of one message", () => {
  native.context.queue = stubQueue();
  mount(() => <QueuedMessagesScreen />);
  expect(screen.getByText("First request")).toBeTruthy();
  act(() => fireEvent.click(screen.getByRole("button", { name: /Second request/ })));
  expect(native.push).toHaveBeenCalledWith({
    pathname: "/queued-messages/actions",
    params: { deliveryId: "two" },
  });
});

it("keeps the held message listed after the host hides it from the queue snapshot", () => {
  native.context.queue = stubQueue({
    queued: [second],
    deliveries: [second],
    edit: {
      editId: "edit-1",
      initialized: true,
      delivery: first,
      text: "First request",
      keepAttachmentIds: [],
      addedAttachments: [],
    },
    confirmed: true,
  });
  mount(() => <QueuedMessagesScreen />);
  expect(screen.getByRole("button", { name: /First request.*Editing/ })).toBeTruthy();
  expect(screen.getByText("Second request")).toBeTruthy();
});

it("reports an empty queue", () => {
  native.context.queue = stubQueue({ queued: [], deliveries: [] });
  mount(() => <QueuedMessagesScreen />);
  expect(screen.getByText("No queued messages")).toBeTruthy();
});

it("shows an uploading message with its progress and cancels it", () => {
  const cancel = vi.fn();
  native.context.queue = stubQueue({ queued: [], deliveries: [] });
  native.context.pending = {
    message: {
      id: "local",
      kind: "message",
      author: "user",
      body: "Uploading now",
      streaming: false,
      replyToMessageId: null,
      attachments: [],
    },
    progress: 1,
    total: 3,
    cancel,
  };
  mount(() => <QueuedMessagesScreen />);
  expect(screen.getByText("Uploading 1 of 3")).toBeTruthy();
  act(() => fireEvent.click(screen.getByRole("button", { name: "Cancel queued upload" })));
  expect(cancel).toHaveBeenCalled();
});

it("steers a queued message and returns to the list", async () => {
  const queue = stubQueue();
  native.context.queue = queue;
  mount(() => <QueuedMessageActionsScreen />);
  act(() => fireEvent.click(screen.getByRole("button", { name: "Steer" })));
  expect(queue.steer).toHaveBeenCalledWith(first);
  await act(async () => {});
  expect(native.back).toHaveBeenCalled();
});

it("disables move to first on the first message", () => {
  native.context.queue = stubQueue();
  mount(() => <QueuedMessageActionsScreen />);
  expect(screen.getByRole("button", { name: "Move to first" }).hasAttribute("disabled")).toBe(true);
  native.params = { deliveryId: "two" };
  mount(() => <QueuedMessageActionsScreen />);
  expect(screen.getAllByRole("button", { name: "Move to first" }).at(-1)?.hasAttribute("disabled")).toBe(false);
});

it("confirms before it deletes a queued message", async () => {
  const queue = stubQueue();
  native.context.queue = queue;
  mount(() => <QueuedMessageActionsScreen />);
  act(() => fireEvent.click(screen.getByRole("button", { name: "Delete" })));
  expect(queue.remove).not.toHaveBeenCalled();
  const buttons: { text: string; onPress?: () => void }[] = native.alert.mock.calls[0][2];
  act(() => buttons.find((button) => button.text === "Delete")?.onPress?.());
  expect(queue.remove).toHaveBeenCalledWith(first);
  await act(async () => {});
  expect(native.back).toHaveBeenCalled();
});

it("opens the edit page for the selected message", () => {
  native.context.queue = stubQueue();
  mount(() => <QueuedMessageActionsScreen />);
  act(() => fireEvent.click(screen.getByRole("button", { name: "Edit" })));
  expect(native.push).toHaveBeenCalledWith({ pathname: "/queued-messages/edit", params: { deliveryId: "one" } });
});

it("holds the message on the host when the edit page opens", () => {
  const queue = stubQueue();
  native.context.queue = queue;
  mount(() => <QueuedMessageEditScreen />);
  expect(queue.begin).toHaveBeenCalledWith(first);
  expect(screen.getByText("Holding the message for you…")).toBeTruthy();
});

const heldEdit = {
  editId: "edit-1",
  initialized: true,
  delivery: first,
  text: "First request",
  keepAttachmentIds: [],
  addedAttachments: [],
};

it("saves the edited text without new uploads", async () => {
  const queue = stubQueue({ edit: heldEdit, confirmed: true });
  native.context.queue = queue;
  mount(() => <QueuedMessageEditScreen />);
  expect(queue.begin).not.toHaveBeenCalled();
  const input = screen.getByRole("textbox", { name: "Message" });
  act(() => fireEvent.change(input, { target: { value: "Changed request" } }));
  expect(queue.changeText).toHaveBeenCalledWith("Changed request");
  act(() => fireEvent.click(screen.getByRole("button", { name: "Save queued message" })));
  await act(async () => {});
  expect(queue.save).toHaveBeenCalledWith("Changed request", []);
  expect(native.back).toHaveBeenCalled();
});

it("shows typed text at once, without waiting for the controller behind the sheet", () => {
  // The controller lives on the chat screen and reports its text one commit later.
  native.context.queue = stubQueue({ edit: heldEdit, confirmed: true });
  mount(() => <QueuedMessageEditScreen />);
  const input = screen.getByRole("textbox", { name: "Message" });
  act(() => fireEvent.change(input, { target: { value: "Changed request" } }));
  expect(screen.getByDisplayValue("Changed request")).toBeTruthy();
});

it("asks before it leaves an edited message, then releases the host hold", async () => {
  const queue = stubQueue({ edit: heldEdit, confirmed: true });
  native.context.queue = queue;
  mount(() => <QueuedMessageEditScreen />);
  // A held message always blocks removal, so every exit releases the hold.
  expect(native.guard.prevent).toBe(true);
  act(() =>
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Changed request" } }),
  );

  act(() => native.guard.callback?.({ data: { action: "pop" } }));
  expect(queue.cancelEdit).not.toHaveBeenCalled();
  const buttons: { text: string; onPress?: () => void }[] = native.alert.mock.calls[0][2];
  act(() => buttons.find((button) => button.text === "Discard")?.onPress?.());
  expect(queue.cancelEdit).toHaveBeenCalled();
  await act(async () => {});
  expect(native.dispatch).toHaveBeenCalledWith("pop");
});

it("releases the host hold without a prompt when nothing was edited", async () => {
  const queue = stubQueue({ edit: heldEdit, confirmed: true });
  native.context.queue = queue;
  mount(() => <QueuedMessageEditScreen />);
  act(() => native.guard.callback?.({ data: { action: "pop" } }));
  expect(native.alert).not.toHaveBeenCalled();
  expect(queue.cancelEdit).toHaveBeenCalled();
  await act(async () => {});
  expect(native.dispatch).toHaveBeenCalledWith("pop");
});

it("offers only a close action when the queued message is gone", async () => {
  const queue = stubQueue({ edit: heldEdit, editUnavailable: true });
  native.context.queue = queue;
  mount(() => <QueuedMessageEditScreen />);
  expect(screen.getByText("The agent already received this message, so it cannot be changed.")).toBeTruthy();
  act(() => fireEvent.click(screen.getByRole("button", { name: "Close" })));
  expect(queue.discardFinishedEdit).toHaveBeenCalled();
  await act(async () => {});
  expect(native.back).toHaveBeenCalled();
});
