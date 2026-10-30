import { useCallback, useMemo, useRef, useState } from "react";
import {
  GestureStateManager,
  type PanGesture,
  type PanGestureConfig,
  usePanGesture,
  useSimultaneousGestures,
} from "react-native-gesture-handler";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";

export const PIN_REVEAL_DISTANCE = 88;
export const PIN_COMMIT_DISTANCE = 144;
const PIN_DISARM_DISTANCE = 128;

function thresholdFeedback() {
  void haptics.impact("light");
}

export function useAgentPinSwipe(
  openingGesture: PanGesture,
  onPin: (withHaptic: boolean) => void,
  pinBlocked: boolean,
) {
  const swipeable = useRef<SwipeableMethods>(null);
  const restOffset = useSharedValue(0);
  const pendingPin = useRef<boolean | null>(null);
  const origin = useSharedValue({ x: 0, y: 0 });
  const start = useSharedValue(0);
  const active = useSharedValue(false);
  const armed = useSharedValue(false);
  const feedbackPlayed = useSharedValue(false);
  const committing = useSharedValue(false);
  const [revealed, setRevealed] = useState(false);
  const [pinPending, setPinPending] = useState(false);

  const close = useCallback(() => swipeable.current?.close(), []);
  const restore = useCallback(() => {
    if (restOffset.get() < 0) swipeable.current?.openRight();
    else swipeable.current?.close();
  }, [restOffset]);

  const pin = useCallback(
    (withHaptic = true) => {
      if (committing.get()) return;
      committing.set(true);
      setPinPending(true);
      if (pinBlocked) {
        void haptics.notification("warning");
        swipeable.current?.close();
        return;
      }
      pendingPin.current = withHaptic;
      swipeable.current?.close();
    },
    [committing, pinBlocked],
  );

  const onWillOpen = () => {
    restOffset.set(-PIN_REVEAL_DISTANCE);
    setRevealed(true);
  };
  const onWillClose = () => {
    restOffset.set(0);
    setRevealed(false);
  };
  const onClose = () => {
    const withHaptic = pendingPin.current;
    pendingPin.current = null;
    committing.set(false);
    setPinPending(false);
    if (withHaptic !== null) {
      if (pinBlocked) void haptics.notification("warning");
      else onPin(withHaptic);
    }
  };

  // Swipeable owns movement and settling. This simultaneous observer adds only
  // the full-swipe threshold and resolves conflicts with the server drawer. It is a hook gesture
  // because ReanimatedSwipeable relations accept only hook gestures. The memoized config keeps
  // the gesture object stable, so its callbacks need the worklet directive.
  const config = useMemo<PanGestureConfig>(
    () => ({
      manualActivation: true,
      enableTrackpadTwoFingerGesture: true,
      // A closed row yields rightward movement to the drawer. An exposed row owns
      // the same movement so it can close without opening the drawer.
      block: openingGesture,
      onTouchesDown: (event) => {
        "worklet";
        if (active.get()) return;
        const touch = event.allTouches[0];
        if (!touch || event.numberOfTouches > 2 || committing.get()) {
          GestureStateManager.fail(event.handlerTag);
          return;
        }
        origin.set({ x: touch.absoluteX, y: touch.absoluteY });
      },
      onTouchesMove: (event) => {
        "worklet";
        if (active.get()) return;
        const touch = event.allTouches[0];
        if (!touch || event.numberOfTouches > 2) {
          GestureStateManager.fail(event.handlerTag);
          return;
        }
        const dx = touch.absoluteX - origin.get().x;
        const dy = touch.absoluteY - origin.get().y;
        if (Math.abs(dy) > 10) GestureStateManager.fail(event.handlerTag);
        else if (dx < -10 || (restOffset.get() < 0 && dx > 10)) GestureStateManager.activate(event.handlerTag);
        else if (dx > 10) GestureStateManager.fail(event.handlerTag);
      },
      onActivate: () => {
        "worklet";
        active.set(true);
        start.set(restOffset.get());
        armed.set(false);
        feedbackPlayed.set(false);
      },
      onUpdate: (event) => {
        "worklet";
        const distance = Math.max(0, -(start.get() + event.translationX));
        if (distance >= PIN_COMMIT_DISTANCE && !armed.get()) {
          armed.set(true);
          if (!pinBlocked && !feedbackPlayed.get()) {
            feedbackPlayed.set(true);
            scheduleOnRN(thresholdFeedback);
          }
        } else if (distance < PIN_DISARM_DISTANCE) armed.set(false);
      },
      onDeactivate: (event) => {
        "worklet";
        if (!event.canceled && armed.get()) scheduleOnRN(pin, false);
      },
      onFinalize: (event) => {
        "worklet";
        if (!active.get()) return;
        active.set(false);
        armed.set(false);
        if (event.canceled && !committing.get()) scheduleOnRN(restore);
      },
    }),
    [active, armed, committing, feedbackPlayed, openingGesture, origin, pin, pinBlocked, restOffset, restore, start],
  );
  const gesture = usePanGesture(config);

  // On Android the swipe takes a drag that moves 10 points sideways, also while the list scrolls, and
  // then the list stops. The swipe waits for this guard to fail, and the guard fails only when the drag
  // moves sideways before it moves down or up. It never activates, so a vertical drag stays with the list.
  const guardOrigin = useSharedValue({ x: 0, y: 0 });
  const guardConfig = useMemo<PanGestureConfig>(
    () => ({
      manualActivation: true,
      onTouchesDown: (event) => {
        "worklet";
        const touch = event.allTouches[0];
        if (touch) guardOrigin.set({ x: touch.absoluteX, y: touch.absoluteY });
      },
      onTouchesMove: (event) => {
        "worklet";
        const touch = event.allTouches[0];
        if (!touch) return;
        const dx = Math.abs(touch.absoluteX - guardOrigin.get().x);
        const dy = Math.abs(touch.absoluteY - guardOrigin.get().y);
        if (dx > 10 && dx > dy) GestureStateManager.fail(event.handlerTag);
      },
    }),
    [guardOrigin],
  );
  const scrollGuard = usePanGesture(guardConfig);
  const guardedGesture = useSimultaneousGestures(gesture, scrollGuard);
  const swipeRequires = useMemo(
    () => (isAndroid ? [openingGesture, scrollGuard] : openingGesture),
    [openingGesture, scrollGuard],
  );

  return {
    close,
    gesture,
    /** The gesture of the row's detector: on Android with the scroll guard. */
    detectorGesture: isAndroid ? guardedGesture : gesture,
    /** What the swipe waits for: the drawer, and on Android the scroll guard. */
    swipeRequires,
    onClose,
    onWillClose,
    onWillOpen,
    pin,
    pinPending,
    revealed,
    swipeable,
  };
}
