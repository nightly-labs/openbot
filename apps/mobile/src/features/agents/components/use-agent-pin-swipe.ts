import { useCallback, useMemo, useRef, useState } from "react";
import { Gesture, type PanGesture } from "react-native-gesture-handler";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "@/shared/lib/haptics";

export const PIN_REVEAL_DISTANCE = 88;
export const PIN_COMMIT_DISTANCE = 144;
const PIN_DISARM_DISTANCE = 128;

function thresholdFeedback() {
  void haptics.impact("light");
}

export function useAgentPinSwipe(openingGesture: PanGesture, onPin: (withHaptic: boolean) => void) {
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
      if (pendingPin.current !== null) return;
      pendingPin.current = withHaptic;
      committing.set(true);
      setPinPending(true);
      swipeable.current?.close();
    },
    [committing],
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
    if (withHaptic !== null) onPin(withHaptic);
  };

  // Swipeable owns movement and settling. This simultaneous observer adds only
  // the full-swipe threshold and resolves conflicts with the server drawer.
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .enableTrackpadTwoFingerGesture(true)
        // A closed row yields rightward movement to the drawer. An exposed row owns
        // the same movement so it can close without opening the drawer.
        .blocksExternalGesture(openingGesture)
        .onTouchesDown((event, manager) => {
          if (active.get()) return;
          const touch = event.allTouches[0];
          if (!touch || event.numberOfTouches > 2 || committing.get()) {
            manager.fail();
            return;
          }
          origin.set({ x: touch.absoluteX, y: touch.absoluteY });
        })
        .onTouchesMove((event, manager) => {
          if (active.get()) return;
          const touch = event.allTouches[0];
          if (!touch || event.numberOfTouches > 2) {
            manager.fail();
            return;
          }
          const dx = touch.absoluteX - origin.get().x;
          const dy = touch.absoluteY - origin.get().y;
          if (Math.abs(dy) > 10) manager.fail();
          else if (dx < -10 || (restOffset.get() < 0 && dx > 10)) manager.activate();
          else if (dx > 10) manager.fail();
        })
        .onStart(() => {
          active.set(true);
          start.set(restOffset.get());
          armed.set(false);
          feedbackPlayed.set(false);
        })
        .onUpdate((event) => {
          const distance = Math.max(0, -(start.get() + event.translationX));
          if (distance >= PIN_COMMIT_DISTANCE && !armed.get()) {
            armed.set(true);
            if (!feedbackPlayed.get()) {
              feedbackPlayed.set(true);
              scheduleOnRN(thresholdFeedback);
            }
          } else if (distance < PIN_DISARM_DISTANCE) armed.set(false);
        })
        .onEnd((_event, success) => {
          if (success && armed.get()) scheduleOnRN(pin, false);
        })
        .onFinalize((_event, success) => {
          if (!active.get()) return;
          active.set(false);
          armed.set(false);
          if (!success && !committing.get()) scheduleOnRN(restore);
        }),
    [active, armed, committing, feedbackPlayed, openingGesture, origin, pin, restOffset, restore, start],
  );

  return { close, gesture, onClose, onWillClose, onWillOpen, pin, pinPending, revealed, swipeable };
}
