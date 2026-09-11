import { fireEvent, screen } from "@testing-library/dom";
import { act, type PropsWithChildren, useImperativeHandle } from "react";
import { createRoot } from "react-dom/client";
import type { PanGesture } from "react-native-gesture-handler";
import { type SwipeableProps, SwipeDirection } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSharedValue } from "react-native-reanimated";
import { afterEach, expect, it, vi } from "vitest";
import { AgentPinSwipeRow } from "./agent-pin-swipe-row";

type Motion = { translationX: number; velocityX: number };
type Touch = { allTouches: { absoluteX: number; absoluteY: number }[]; numberOfTouches: number };
type Manager = { activate: () => void; fail: () => void };
const native = vi.hoisted(() => {
  const handlers = {
    down: (_e: Touch, _m: Manager) => {},
    move: (_e: Touch, _m: Manager) => {},
    start: () => {},
    update: (_e: Motion) => {},
    end: (_e: Motion, _success: boolean) => {},
    finalize: (_e: Motion, _success: boolean) => {},
  };
  const springs: ((finished: boolean) => void)[] = [];
  const props: SwipeableProps = {};
  return { handlers, springs, props, impact: vi.fn(), notification: vi.fn(), blocked: vi.fn() };
});

// Replace only native event delivery and animation completion. The real gesture
// callbacks decide ownership, thresholds, cancellation, haptics and pinning.
vi.mock("react-native-gesture-handler", () => ({
  GestureDetector: ({ children }: PropsWithChildren) => children,
  Gesture: {
    Pan: () => {
      const gesture = {
        manualActivation: () => gesture,
        enableTrackpadTwoFingerGesture: () => gesture,
        blocksExternalGesture: (other: PanGesture) => {
          native.blocked(other);
          return gesture;
        },
        onTouchesDown: (cb: typeof native.handlers.down) => {
          native.handlers.down = cb;
          return gesture;
        },
        onTouchesMove: (cb: typeof native.handlers.move) => {
          native.handlers.move = cb;
          return gesture;
        },
        onStart: (cb: typeof native.handlers.start) => {
          native.handlers.start = cb;
          return gesture;
        },
        onUpdate: (cb: typeof native.handlers.update) => {
          native.handlers.update = cb;
          return gesture;
        },
        onEnd: (cb: typeof native.handlers.end) => {
          native.handlers.end = cb;
          return gesture;
        },
        onFinalize: (cb: typeof native.handlers.finalize) => {
          native.handlers.finalize = cb;
          return gesture;
        },
      };
      return gesture;
    },
  },
}));
vi.mock("react-native-gesture-handler/ReanimatedSwipeable", () => ({
  SwipeDirection: { LEFT: "left", RIGHT: "right" },
  default: (props: SwipeableProps) => {
    native.props = props;
    const methods = {
      close: () => {
        native.props.onSwipeableWillClose?.(SwipeDirection.RIGHT);
        native.springs.push(() => native.props.onSwipeableClose?.(SwipeDirection.RIGHT));
      },
      openRight: () => native.props.onSwipeableWillOpen?.(SwipeDirection.LEFT),
      openLeft: () => {},
      reset: () => {},
    };
    useImperativeHandle(props.ref, () => methods);
    const progress = useSharedValue(1);
    const translation = useSharedValue(-88);
    return (
      <>
        {props.renderRightActions?.(progress, translation, methods)}
        {props.children}
      </>
    );
  },
}));
vi.mock("@/features/servers/components/app-drawer-shell", () => ({ useAppDrawer: () => ({ openingGesture: {} }) }));
vi.mock("@/shared/lib/haptics", () => ({ haptics: { impact: native.impact, notification: native.notification } }));
vi.mock("react-native-worklets", () => ({
  scheduleOnRN: (fn: (value?: boolean) => void, value?: boolean) => fn(value),
}));
vi.mock("react-native", () => ({
  View: ({ children, accessibilityElementsHidden }: PropsWithChildren<{ accessibilityElementsHidden?: boolean }>) => (
    <div aria-hidden={accessibilityElementsHidden}>{children}</div>
  ),
  Pressable: ({
    children,
    accessibilityLabel,
    onPress,
  }: PropsWithChildren<{ accessibilityLabel: string; onPress: () => void }>) => (
    <button type="button" aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("react-native-reanimated", async () => {
  const { useRef } = await import("react");
  return {
    default: {
      View: ({
        children,
        accessibilityElementsHidden,
      }: PropsWithChildren<{ accessibilityElementsHidden?: boolean }>) => (
        <div aria-hidden={accessibilityElementsHidden}>{children}</div>
      ),
    },
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => false,
    ReduceMotion: { System: "system" },
    useSharedValue: <T,>(value: T) =>
      useRef({
        value,
        get() {
          return this.value;
        },
        set(next: T) {
          this.value = next;
        },
      }).current,
  };
});
vi.mock("heroui-native/hooks", () => ({ useThemeColor: () => ["background", "foreground"] }));
vi.mock("heroui-native", () => ({
  Typography: { Paragraph: ({ children }: PropsWithChildren) => <span>{children}</span> },
}));
vi.mock("lucide-react-native", () => ({ Pin: () => null }));
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(async () => {
  await act(() => root.unmount());
  root = createRoot(container);
  native.springs = [];
  native.impact.mockClear();
  native.notification.mockClear();
  native.blocked.mockClear();
});
async function renderRow(pinBlocked = false) {
  const onPin = vi.fn();
  await act(() =>
    root.render(
      <AgentPinSwipeRow agentName="Ada" pinBlocked={pinBlocked} onPin={onPin}>
        <button type="button">Open chat with Ada</button>
      </AgentPinSwipeRow>,
    ),
  );
  return onPin;
}
const motion = (translationX: number): Motion => ({ translationX, velocityX: 0 });
const touch = (x: number, y = 0): Touch => ({ allTouches: [{ absoluteX: x, absoluteY: y }], numberOfTouches: 1 });
function begin() {
  native.handlers.start();
}
function move(x: number) {
  native.handlers.update(motion(x));
}
async function release(x: number, success = true, opens = true) {
  await act(() => {
    // Deliver the library's settle event separately from the observer's release.
    if (success) {
      if (opens) native.props.onSwipeableWillOpen?.(SwipeDirection.LEFT);
      else native.props.onSwipeableWillClose?.(SwipeDirection.RIGHT);
    }
    native.handlers.end(motion(x), success);
    native.handlers.finalize(motion(x), success);
  });
}
// An enabled native pan can cancel the close spring before its completion.
// The observer failing does not stop Swipeable's separate movement gesture.
async function interruptWithSwipe() {
  await act(() => {
    if (native.props.enabled === false) return;
    native.springs = [];
    native.props.onSwipeableWillOpen?.(SwipeDirection.LEFT);
  });
}
async function finish() {
  await act(() =>
    native.springs.splice(0).forEach((done) => {
      done(true);
    }),
  );
}

it("reveals without pinning, then arms on a further drag and pins only after release", async () => {
  const onPin = await renderRow();
  begin();
  move(-88);
  await release(-88);
  expect(screen.getByRole("button", { name: "Close pin action for Ada" })).toBeTruthy();
  expect(onPin).not.toHaveBeenCalled();
  expect(native.impact).not.toHaveBeenCalled();
  begin();
  move(-55);
  expect(native.impact).not.toHaveBeenCalled();
  move(-56);
  expect(native.impact).toHaveBeenCalledExactlyOnceWith("light");
  expect(onPin).not.toHaveBeenCalled();
  move(-70);
  expect(native.impact).toHaveBeenCalledOnce();
  await release(-70);
  await interruptWithSwipe();
  await finish();
  expect(onPin).toHaveBeenCalledExactlyOnceWith(false);
});
it("disarms when reversed below the threshold and permits a rightward close", async () => {
  const onPin = await renderRow();
  begin();
  move(-150);
  move(-120);
  await release(-120);
  await finish();
  expect(onPin).not.toHaveBeenCalled();
  begin();
  move(88);
  await release(88, true, false);
  expect(screen.queryByRole("button", { name: "Close pin action for Ada" })).toBeNull();
  expect(screen.getByRole("button", { name: "Open chat with Ada" })).toBeTruthy();
});
it("does not pin on cancellation or a short fast flick", async () => {
  const onPin = await renderRow();
  begin();
  move(-150);
  await release(-150, false);
  await finish();
  expect(onPin).not.toHaveBeenCalled();
  begin();
  move(-30);
  await act(() => native.handlers.end({ translationX: -30, velocityX: -2000 }, true));
  await finish();
  expect(onPin).not.toHaveBeenCalled();
});
it("lets the drawer and vertical scroll win on closed rows, but closes exposed rows itself", async () => {
  await renderRow();
  const manager = { activate: vi.fn(), fail: vi.fn() };
  native.handlers.down(touch(0), manager);
  native.handlers.move(touch(20), manager);
  expect(manager.fail).toHaveBeenCalledOnce();
  native.handlers.down(touch(0), manager);
  native.handlers.move(touch(-5, 20), manager);
  expect(manager.fail).toHaveBeenCalledTimes(2);
  native.handlers.down(touch(0), manager);
  native.handlers.move(touch(-20), manager);
  expect(manager.activate).toHaveBeenCalledOnce();
  begin();
  move(-88);
  await release(-88);
  native.handlers.down(touch(0), manager);
  native.handlers.move(touch(20), manager);
  expect(manager.activate).toHaveBeenCalledTimes(2);
  expect(native.blocked).toHaveBeenCalled();
});
it("keeps a pending pin closing through repeat taps and swipes, then accepts swipes again", async () => {
  const onPin = await renderRow();
  begin();
  move(-88);
  await release(-88);
  await act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Pin Ada" }));
    fireEvent.click(screen.getByRole("button", { name: "Pin Ada" }));
  });
  await interruptWithSwipe();
  await finish();
  expect(onPin).toHaveBeenCalledExactlyOnceWith(true);
  await interruptWithSwipe();
  expect(screen.getByRole("button", { name: "Close pin action for Ada" })).toBeTruthy();
});

it("closes the exposed action on tap and hides the action from accessibility when closed", async () => {
  const onPin = await renderRow();
  expect(screen.queryByRole("button", { name: "Pin Ada" })).toBeNull();
  begin();
  move(-88);
  await release(-88);
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Close pin action for Ada" })));
  expect(screen.queryByRole("button", { name: "Pin Ada" })).toBeNull();
  expect(screen.getByRole("button", { name: "Open chat with Ada" })).toBeTruthy();
  expect(onPin).not.toHaveBeenCalled();
});

it("closes the row after a blocked pin tap without pinning", async () => {
  const onPin = await renderRow(true);
  begin();
  move(-88);
  await release(-88);
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Pin Ada" })));
  await interruptWithSwipe();
  await finish();
  expect(native.notification).toHaveBeenCalledExactlyOnceWith("warning");
  expect(onPin).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Pin Ada" })).toBeNull();
  expect(screen.getByRole("button", { name: "Open chat with Ada" })).toBeTruthy();
});

it("rejects a full swipe at capacity with one warning and no pin threshold haptic", async () => {
  const onPin = await renderRow(true);
  begin();
  move(-150);
  await release(-150);
  await interruptWithSwipe();
  await finish();
  expect(native.notification).toHaveBeenCalledExactlyOnceWith("warning");
  expect(native.impact).not.toHaveBeenCalled();
  expect(onPin).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Pin Ada" })).toBeNull();
  expect(screen.getByRole("button", { name: "Open chat with Ada" })).toBeTruthy();
});
