import type { QueueDelivery } from "@openbot/contracts/ipc";
import { fireEvent, screen } from "@testing-library/dom";
import { act, type PropsWithChildren, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, assert, expect, it, vi } from "vitest";
import type { ChatQueueController } from "../components/use-chat-queue";
import type { QueuedUpload } from "../context/queued-messages-context";
import { QueuedMessageActionsScreen } from "./queued-message-actions-screen";
import { QueuedMessageEditScreen } from "./queued-message-edit-screen";
import { QueuedMessagesScreen } from "./queued-messages-screen";

const native = vi.hoisted(() => {
  const params: { chat: string; deliveryId: string } = { chat: "host:agent", deliveryId: "one" };
  const guard: { prevent: boolean; callback: ((event: { data: { action: string } }) => void) | null } = {
    prevent: false,
    callback: null,
  };
  const context: { queue: ChatQueueController | null; pending: QueuedUpload | null } = { queue: null, pending: null };
  const attachments: { preparing: boolean } = { preparing: false };
  return {
    push: vi.fn(),
    back: vi.fn(),
    alert: vi.fn(),
    selection: vi.fn(async () => {}),
    impact: vi.fn(async () => {}),
    notification: vi.fn(async () => {}),
    params,
    context,
    attachments,
    guard,
    dispatch: vi.fn(),
    chooseFiles: vi.fn(),
    share: vi.fn(),
    choosePhotos: vi.fn(),
    removeAttachment: vi.fn(),
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
// The sheet reads the chat it was opened for, so an unrelated identity finds no queue.
vi.mock("../context/queued-messages-context", () => ({
  useQueuedChat: (chatId?: string) => (chatId === "host:agent" ? native.context : { queue: null, pending: null }),
}));
// The preview downloads from the host; the rows under test only need to say which one they show.
vi.mock("../components/attachment-preview", () => ({
  AttachmentThumbnail: ({ name, uri }: { name: string; uri: string | null }) => (
    <span>{uri ? `image ${name}` : `file ${name}`}</span>
  ),
  localAttachmentPreview: (file: { mimeType: string; uri?: string }) =>
    file.mimeType.startsWith("image/") ? (file.uri ?? null) : null,
  useAttachmentFile: (_serverId: string, attachment: { previewUrl: string | null }, preview: boolean) => ({
    uri: preview ? attachment.previewUrl : null,
    busy: false,
    share: native.share,
  }),
}));
vi.mock("../components/use-chat-attachments", () => ({
  useChatAttachments: (initial: { id: string; name: string }[]) => ({
    items: initial,
    preparing: native.attachments.preparing,
    chooseFiles: native.chooseFiles,
    choosePhotos: native.choosePhotos,
    remove: native.removeAttachment,
  }),
}));
vi.mock("@/shared/lib/haptics", () => ({
  haptics: { selection: native.selection, impact: native.impact, notification: native.notification },
}));
vi.mock("heroui-native/hooks", () => ({ useThemeColor: () => "gray" }));
vi.mock("uniwind", () => ({ useCSSVariable: () => "red" }));
vi.mock("lucide-react-native", () => ({
  ArrowUpToLine: () => null,
  CornerDownRight: () => null,
  ExternalLink: () => null,
  FileText: () => null,
  ImagePlus: () => null,
  Paperclip: () => null,
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
  native.attachments.preparing = false;
  native.params = { chat: "host:agent", deliveryId: "one" };
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
    chatId: "host:agent",
    agentId: "agent",
    serverId: "host",
    attachments: [],
    changeAttachments: async () => {},
    attachmentSupport: () => ({ eml: true, media: true }),
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
    params: { chat: "host:agent", deliveryId: "two" },
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

it("allows confirmed deletion while another device is editing", async () => {
  const edited = { ...first, editing: true };
  native.context.queue = stubQueue({ queued: [edited, second], deliveries: [edited, second] });
  mount(() => <QueuedMessagesScreen />);
  expect(screen.getByRole("button", { name: /First request.*Editing/ })).toBeTruthy();
  expect(screen.getByText("Second request")).toBeTruthy();

  mount(() => <QueuedMessageActionsScreen />);
  expect(screen.getByRole("button", { name: "Edit" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Steer" }).hasAttribute("disabled")).toBe(true);
  act(() => fireEvent.click(screen.getByRole("button", { name: "Delete" })));
  expect(native.context.queue?.remove).not.toHaveBeenCalled();
  const [alertCall] = native.alert.mock.calls;
  assert(alertCall);
  const buttons: { text: string; onPress?: () => void }[] = alertCall[2];
  act(() => buttons.find((button) => button.text === "Delete")?.onPress?.());
  expect(native.context.queue?.remove).toHaveBeenCalledWith(edited);
  await act(async () => {});
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

it("offers a retry when the queue did not load", () => {
  const queue = stubQueue({ queued: [], deliveries: [], error: "Could not load the queue." });
  native.context.queue = queue;
  mount(() => <QueuedMessagesScreen />);
  expect(screen.getByText("Could not load the queue.")).toBeTruthy();
  act(() => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
  expect(queue.refresh).toHaveBeenCalled();
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
  native.params = { chat: "host:agent", deliveryId: "two" };
  mount(() => <QueuedMessageActionsScreen />);
  expect(screen.getAllByRole("button", { name: "Move to first" }).at(-1)?.hasAttribute("disabled")).toBe(false);
});

it("confirms before it deletes a queued message", async () => {
  const queue = stubQueue();
  native.context.queue = queue;
  mount(() => <QueuedMessageActionsScreen />);
  act(() => fireEvent.click(screen.getByRole("button", { name: "Delete" })));
  expect(queue.remove).not.toHaveBeenCalled();
  const [alertCall] = native.alert.mock.calls;
  assert(alertCall);
  const buttons: { text: string; onPress?: () => void }[] = alertCall[2];
  act(() => buttons.find((button) => button.text === "Delete")?.onPress?.());
  expect(queue.remove).toHaveBeenCalledWith(first);
  await act(async () => {});
  expect(native.back).toHaveBeenCalled();
});

it("opens the edit page for the selected message", () => {
  native.context.queue = stubQueue();
  mount(() => <QueuedMessageActionsScreen />);
  act(() => fireEvent.click(screen.getByRole("button", { name: "Edit" })));
  expect(native.push).toHaveBeenCalledWith({
    pathname: "/queued-messages/edit",
    params: { chat: "host:agent", deliveryId: "one" },
  });
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

it("blocks Save while an attachment is still preparing", () => {
  // The file read finishes before the controller sees the new file. Saving in
  // that window would send the previous file list without the selected file.
  native.attachments.preparing = true;
  native.context.queue = stubQueue({ edit: heldEdit, confirmed: true });
  mount(() => <QueuedMessageEditScreen />);
  const input = screen.getByRole("textbox", { name: "Message" });
  act(() => fireEvent.change(input, { target: { value: "Changed request" } }));
  expect(screen.getByRole("button", { name: "Save queued message" }).hasAttribute("disabled")).toBe(true);
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
  const [alertCall] = native.alert.mock.calls;
  assert(alertCall);
  const buttons: { text: string; onPress?: () => void }[] = alertCall[2];
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

it("shows a thumbnail for a queued image and the file icon for other files", () => {
  const sheet = {
    id: "file-1",
    name: "test_csv_file.csv",
    kind: "file" as const,
    mimeType: "text/csv",
    size: 82,
    previewKind: "none" as const,
    previewUrl: null,
  };
  const photo = {
    ...sheet,
    id: "file-2",
    name: "test_png_photo.png",
    kind: "image" as const,
    mimeType: "image/png",
    previewUrl: "file:///photo.png",
  };
  const withFiles = { ...first, attachments: [sheet, photo] };
  native.context.queue = stubQueue({ queued: [withFiles, second], deliveries: [withFiles, second] });
  mount(() => <QueuedMessageActionsScreen />);
  expect(screen.getByText("file test_csv_file.csv")).toBeTruthy();
  expect(screen.getByText("image test_png_photo.png")).toBeTruthy();
  act(() => fireEvent.click(screen.getByRole("button", { name: /test_csv_file\.csv/ })));
  expect(native.share).toHaveBeenCalled();
});

it("opens the queue of the chat the sheet was opened for", () => {
  native.context.queue = stubQueue();
  native.params = { chat: "host:another-agent", deliveryId: "one" };
  mount(() => <QueuedMessageActionsScreen />);
  // A second chat that the native stack keeps mounted must not answer for this sheet.
  expect(screen.getByText("This message is no longer queued.")).toBeTruthy();
});

it("adds a file to the edit and sends it with the saved message", async () => {
  const added = {
    id: "mobile-draft-attachment-1",
    name: "notes.txt",
    mimeType: "text/plain",
    base64: "",
    size: 12,
    uri: "file:///notes.txt",
  };
  const queue = stubQueue({ edit: heldEdit, confirmed: true, attachments: [added] });
  native.context.queue = queue;
  mount(() => <QueuedMessageEditScreen />);
  expect(screen.getByText("notes.txt")).toBeTruthy();
  act(() => fireEvent.click(screen.getByRole("button", { name: /Add files/ })));
  expect(native.chooseFiles).toHaveBeenCalled();
  act(() => fireEvent.click(screen.getByRole("button", { name: "Save queued message" })));
  await act(async () => {});
  expect(queue.save).toHaveBeenCalledWith("First request", [added]);
});

it("keeps the editor open when the host hold cannot be released", async () => {
  const queue = stubQueue({
    edit: heldEdit,
    confirmed: true,
    cancelEdit: vi.fn(async () => false),
    error: "Reconnect to change the queue.",
  });
  native.context.queue = queue;
  mount(() => <QueuedMessageEditScreen />);
  act(() => fireEvent.click(screen.getByRole("button", { name: "Cancel edit" })));
  await act(async () => {});
  expect(queue.cancelEdit).toHaveBeenCalled();
  // The host still holds the message, so a closed editor would leave the queue blocked.
  expect(native.back).not.toHaveBeenCalled();
  expect(screen.getByText("Reconnect to change the queue.")).toBeTruthy();
});

it("asks before it leaves a message the host still holds", async () => {
  const queue = stubQueue({ edit: heldEdit, confirmed: true, cancelEdit: vi.fn(async () => false) });
  native.context.queue = queue;
  mount(() => <QueuedMessageEditScreen />);
  act(() => native.guard.callback?.({ data: { action: "pop" } }));
  await act(async () => {});
  expect(native.dispatch).not.toHaveBeenCalled();
  const [alertCall] = native.alert.mock.calls;
  assert(alertCall);
  const buttons: { text: string; onPress?: () => void }[] = alertCall[2];
  act(() => buttons.find((button) => button.text === "Leave anyway")?.onPress?.());
  await act(async () => {});
  expect(native.dispatch).toHaveBeenCalledWith("pop");
});
