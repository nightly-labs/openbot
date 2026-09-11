import { fireEvent, screen } from "@testing-library/dom";
import { act, type PropsWithChildren, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import MessageActionsScreen from "@/app/(app)/message-actions";
import SelectMessageTextScreen from "@/app/(app)/message-actions/select-text";
import { ChatMessageGesture } from "../components/chat-message-gesture";
import { MessageActionsProvider, useMessageActions } from "./message-actions-context";

const mocks = vi.hoisted(() => ({
  copy: vi.fn(async (_text: string) => {}),
  back: vi.fn(),
  push: vi.fn(),
  alert: vi.fn(),
}));
const Container = ({ children }: PropsWithChildren) => <div>{children}</div>;
vi.mock("react-native", () => ({
  Alert: { alert: mocks.alert },
  // iOS accessible containers combine their children into one accessibility element.
  View: ({ children, accessible }: PropsWithChildren<{ accessible?: boolean }>) => (
    <div>{accessible ? <div aria-hidden="true">{children}</div> : children}</div>
  ),
  TextInput: ({
    value,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    editable: boolean;
    accessibilityLabel: string;
  }) => <textarea aria-label={accessibilityLabel} value={value} readOnly={!editable} />,
}));
vi.mock("@/shared/lib/platform", () => ({ isIOS: true }));
vi.mock("expo-clipboard", () => ({ setStringAsync: mocks.copy }));
vi.mock("@/shared/lib/haptics", () => ({ haptics: { impact: async () => {} } }));
vi.mock("react-native-reanimated", async () => {
  const { View } = await import("react-native");
  return {
    default: { View },
    ReduceMotion: { System: "system" },
    useAnimatedStyle: () => ({}),
    useSharedValue: (initial: number) => ({ get: () => initial, set: () => {} }),
    withSpring: (value: number) => value,
  };
});
vi.mock("react-native-worklets", () => ({ scheduleOnRN: (callback: () => void) => callback() }));
vi.mock("react-native-gesture-handler", () => {
  function gesture() {
    return {
      enabled() {
        return this;
      },
      activeOffsetX() {
        return this;
      },
      failOffsetX() {
        return this;
      },
      failOffsetY() {
        return this;
      },
      onUpdate() {
        return this;
      },
      onEnd() {
        return this;
      },
      onFinalize() {
        return this;
      },
      onStart() {
        return this;
      },
    };
  }
  return {
    Gesture: { Pan: gesture, LongPress: gesture, Race: gesture },
    GestureDetector: ({ children }: PropsWithChildren) => children,
  };
});
vi.mock("heroui-native/hooks", () => ({ useThemeColor: () => "black" }));
vi.mock("heroui-native", () => ({
  Button: Object.assign(
    ({ children, onPress }: PropsWithChildren<{ onPress: () => void }>) => (
      <button type="button" onClick={onPress}>
        {children}
      </button>
    ),
    { Label: ({ children }: PropsWithChildren) => <span>{children}</span> },
  ),
  Typography: Object.assign(({ children }: PropsWithChildren) => <span>{children}</span>, {
    Paragraph: ({ children }: PropsWithChildren) => <p>{children}</p>,
  }),
}));
vi.mock("lucide-react-native", () => ({ Copy: () => null, Reply: () => null, TextSelect: () => null }));
vi.mock("@/shared/components/sheet-scroll-view", () => ({
  SheetScrollView: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("@/features/settings/components/settings-content", () => ({
  SettingsContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingsSection: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingsRow: ({ children, onPress, disabled }: PropsWithChildren<{ onPress: () => void; disabled?: boolean }>) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("expo-router", () => ({
  router: { back: mocks.back, push: mocks.push },
  Stack: {
    Toolbar: Object.assign(({ children }: PropsWithChildren) => <div>{children}</div>, {
      Button: ({
        children,
        onPress,
        accessibilityLabel,
      }: PropsWithChildren<{ onPress: () => void; accessibilityLabel: string }>) => (
        <button type="button" aria-label={accessibilityLabel} onClick={onPress}>
          {children}
        </button>
      ),
    }),
  },
}));

const message = {
  id: "answer",
  kind: "message" as const,
  author: "agent" as const,
  body: "First line\nSecond line",
  streaming: false,
};
function Harness({ canReply = true }: { canReply?: boolean }) {
  const { select, selected } = useMessageActions();
  const [reply, setReply] = useState("");
  return (
    <Container>
      <button type="button" onClick={() => select({ message, onReply: canReply ? () => setReply(message.id) : null })}>
        Open actions
      </button>
      <output aria-label="Reply target">{reply}</output>
      {selected ? (
        <>
          <MessageActionsScreen />
          <SelectMessageTextScreen />
        </>
      ) : null}
    </Container>
  );
}
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(async () => {
  await act(() => root.unmount());
  root = createRoot(container);
  vi.clearAllMocks();
});

it("keeps code copy and message actions separately accessible with a screen reader", async () => {
  const copyCode = vi.fn();
  const openActions = vi.fn();
  await act(() =>
    root.render(
      <ChatMessageGesture screenReaderEnabled onOpenActions={openActions}>
        <button type="button" onClick={copyCode}>
          Copy code
        </button>
      </ChatMessageGesture>,
    ),
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy code" })));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Message actions" })));
  expect({ copiedCode: copyCode.mock.calls.length, openedActions: openActions.mock.calls.length }).toEqual({
    copiedCode: 1,
    openedActions: 1,
  });
});
async function open(canReply = true) {
  await act(() =>
    root.render(
      <MessageActionsProvider>
        <Harness canReply={canReply} />
      </MessageActionsProvider>,
    ),
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open actions" })));
}

it("replies to the selected message and returns to chat", async () => {
  await open();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reply" })));
  expect({
    target: screen.getByRole("status", { name: "Reply target" }).textContent,
    dismissals: mocks.back.mock.calls.length,
  }).toEqual({ target: "answer", dismissals: 1 });
});

it("opens text selection without placing message text in the route", async () => {
  await open();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Select Text" })));
  expect(mocks.push.mock.calls).toEqual([["/message-actions/select-text"]]);
});

it("copies the full message and keeps the selection page open", async () => {
  await open();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy message" })));
  expect({
    copied: mocks.copy.mock.calls,
    dismissed: mocks.back.mock.calls.length,
    confirmed: screen.getByRole("button", { name: "Message copied" }).textContent,
  }).toEqual({ copied: [[message.body]], dismissed: 0, confirmed: "Copied" });
});

it("keeps actions open when copying fails", async () => {
  mocks.copy.mockRejectedValueOnce(new Error("Clipboard unavailable"));
  await open(false);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy" })));
  expect({ error: mocks.alert.mock.calls, dismissed: mocks.back.mock.calls.length }).toEqual({
    error: [["Could not copy message", "Please try again."]],
    dismissed: 0,
  });
});
