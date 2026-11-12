import { useThemeColor } from "heroui-native/hooks";
import Reply from "lucide-react-native/icons/reply";
import { type PropsWithChildren, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "@/shared/lib/haptics";
import { END_X, MIRROR_IN_RTL } from "@/shared/lib/text-direction";

/** How long a touch and hold lasts before the sheet opens. */
const HOLD_MS = 500;
/**
 * The bubble starts to press in only after this time, so a touch that starts a scroll does not move
 * it. It then shrinks until the hold ends, so the reader sees the hold fill up.
 */
const PRESS_DELAY_MS = 120;
const PRESSED_SCALE = 0.96;
const PRESS_IN = {
  duration: HOLD_MS - PRESS_DELAY_MS,
  easing: Easing.out(Easing.quad),
  reduceMotion: ReduceMotion.System,
};
const RELEASE = { duration: 300, dampingRatio: 0.7, reduceMotion: ReduceMotion.System };

/**
 * A swipe away from the bubble's side of the chat replies: to the right for a bubble at the start,
 * to the left for a bubble at the end. A touch and hold opens the sheet with the message actions. A
 * screen reader cannot use these gestures, so it gets a button for that sheet under the message.
 */
export function ChatMessageGesture({
  children,
  align = "start",
  selecting,
  onReply,
  onHold,
}: PropsWithChildren<{
  /** The side of the chat the bubble sits on. */
  align?: "start" | "end";
  /** The text is selected in the bubble: the handles get the touches, not the swipe. */
  selecting: boolean;
  onReply?: () => void;
  /** Opens the message actions. */
  onHold?: () => void;
}>) {
  const muted = useThemeColor("muted");
  // The swipe distance toward the middle of the chat, in points. A bubble at the end moves left, or
  // right in a right-to-left layout: React Native swaps the sides of the layout, not the gestures and
  // the transforms.
  const offset = useSharedValue(0);
  const direction = (align === "end" ? -1 : 1) * END_X;
  // The press of a touch and hold. It runs on the UI thread, so a press renders nothing in React.
  const pressScale = useSharedValue(1);
  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.get() * direction }, { scale: pressScale.get() }],
  }));
  const iconStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, offset.get() / 64) }));
  // The reply icon behind the bubble mounts with the first swipe, not with each row of the chat.
  // It is clear until the bubble has moved, so it shows in time.
  const [iconShown, setIconShown] = useState(false);
  const handlers = useRef({ onReply, onHold });
  handlers.current = { onReply, onHold };
  const canReply = Boolean(onReply) && !selecting;
  const canHold = Boolean(onHold) && !selecting;
  // Build the gestures once per row. A streaming reply re-renders its row for each chunk, and a new
  // gesture would reconfigure the native handler each time.
  const gesture = useMemo(() => {
    const reply = () => {
      void haptics.impact();
      handlers.current.onReply?.();
    };
    const hold = () => {
      void haptics.longPress();
      handlers.current.onHold?.();
    };
    const swipe = Gesture.Pan()
      .enabled(canReply)
      .activeOffsetX(16 * direction)
      .failOffsetX(-8 * direction)
      .failOffsetY([-12, 12])
      .onStart(() => scheduleOnRN(setIconShown, true))
      .onUpdate((event) => {
        const distance = event.translationX * direction;
        offset.set(Math.max(0, Math.min(distance, 64) + Math.max(0, distance - 64) * 0.15));
      })
      .onEnd((event) => {
        const distance = event.translationX * direction;
        if (distance >= 64 || (distance >= 24 && event.velocityX * direction >= 650)) scheduleOnRN(reply);
      })
      .onFinalize(() => {
        offset.set(withSpring(0, { duration: 400, dampingRatio: 1, reduceMotion: ReduceMotion.System }));
      });
    const press = Gesture.LongPress()
      .enabled(canHold)
      .minDuration(HOLD_MS)
      .onBegin(() => {
        pressScale.set(withDelay(PRESS_DELAY_MS, withTiming(PRESSED_SCALE, PRESS_IN)));
      })
      .onStart(() => {
        pressScale.set(withSpring(1, RELEASE));
        scheduleOnRN(hold);
      })
      .onFinalize(() => {
        pressScale.set(withSpring(1, RELEASE));
      });
    return Gesture.Race(swipe, press);
  }, [canReply, canHold, direction, offset, pressScale]);

  return (
    <View className={align === "end" ? "max-w-full self-end" : "max-w-[92%] self-start"}>
      {iconShown ? (
        <Animated.View
          pointerEvents="none"
          className={`absolute bottom-0 top-0 justify-center ${align === "end" ? "right-0" : "left-0"}`}
          style={iconStyle}
        >
          <Reply color={muted} size={22} style={MIRROR_IN_RTL} />
        </Animated.View>
      ) : null}
      <GestureDetector gesture={gesture}>
        <Animated.View style={bubbleStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}
