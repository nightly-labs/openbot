import { useThemeColor } from "heroui-native/hooks";
import Reply from "lucide-react-native/icons/reply";
import { type PropsWithChildren, useContext, useMemo, useRef, useState } from "react";
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
import { ChatSwipeGestureContext, ChatTimeRevealContext, MESSAGE_TIME_WIDTH } from "./chat-swipe-gesture";

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
const SETTLE = { duration: 400, dampingRatio: 1, reduceMotion: ReduceMotion.System };
/** The bubbles go back after the times with a small overshoot, as in Messages on iOS. */
const TIMES_SETTLE = { duration: 450, dampingRatio: 0.78, reduceMotion: ReduceMotion.System };
/**
 * Past the place where the times stop, the bubbles move on at this part of the finger's distance.
 * The reply swipe resists more: its icon stays at the bubble's side.
 */
const TIMES_OVERSCROLL = 0.4;
const REPLY_OVERSCROLL = 0.15;

/** The distance of a swipe as it moves a view: in full up to `limit`, then at `part` of it. */
function resisted(distance: number, limit: number, part: number): number {
  "worklet";
  return Math.max(0, Math.min(distance, limit) + Math.max(0, distance - limit) * part);
}

/**
 * A swipe toward Back replies, on each bubble: to the right, or to the left in a right-to-left layout.
 * A swipe away from Back moves the chat to show the message times, as in Messages on iOS; beside
 * the bubbles it is the swipe of the chat. A touch and hold opens the
 * sheet with the message actions. A screen reader cannot use these gestures, so it gets a button for
 * that sheet under the message, and the sheet shows the time.
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
  // The reply swipe distance toward Back, in points. React Native swaps the sides of the layout in a
  // right-to-left layout, not the gestures and the transforms.
  const offset = useSharedValue(0);
  // The press of a touch and hold. It runs on the UI thread, so a press renders nothing in React.
  const pressScale = useSharedValue(1);
  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.get() * END_X }, { scale: pressScale.get() }],
  }));
  const iconStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, offset.get() / 64) }));
  // The reply icon behind the bubble mounts with the first swipe, not with each row of the chat.
  // It is clear until the bubble has moved, so it shows in time.
  const [iconShown, setIconShown] = useState(false);
  const handlers = useRef({ onReply, onHold });
  handlers.current = { onReply, onHold };
  const canReply = Boolean(onReply) && !selecting;
  const canHold = Boolean(onHold) && !selecting;
  // The swipe away from Back over the whole list waits for the bubble: on a bubble, the swipe in that
  // direction shows the times and does not open the screen.
  const listSwipe = useContext(ChatSwipeGestureContext);
  const timeReveal = useContext(ChatTimeRevealContext);
  const canRevealTime = timeReveal !== null && !selecting;
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
      .activeOffsetX(16 * END_X)
      .failOffsetX(-8 * END_X)
      .failOffsetY([-12, 12])
      .onStart(() => scheduleOnRN(setIconShown, true))
      .onUpdate((event) => {
        offset.set(resisted(event.translationX * END_X, 64, REPLY_OVERSCROLL));
      })
      .onEnd((event) => {
        const distance = event.translationX * END_X;
        if (distance >= 64 || (distance >= 24 && event.velocityX * END_X >= 650)) scheduleOnRN(reply);
      })
      .onFinalize(() => {
        offset.set(withSpring(0, SETTLE));
      });
    // The times show while the finger holds the chat, and hide when it lets go.
    const times = Gesture.Pan()
      .enabled(canRevealTime)
      .activeOffsetX(-16 * END_X)
      .failOffsetX(8 * END_X)
      .failOffsetY([-12, 12])
      .onStart(() => {
        if (timeReveal) scheduleOnRN(timeReveal.mount);
      })
      .onUpdate((event) => {
        timeReveal?.offset.set(resisted(-event.translationX * END_X, MESSAGE_TIME_WIDTH, TIMES_OVERSCROLL));
      })
      .onFinalize(() => {
        timeReveal?.offset.set(withSpring(0, TIMES_SETTLE));
      });
    if (listSwipe) {
      swipe.blocksExternalGesture(listSwipe);
      times.blocksExternalGesture(listSwipe);
    }
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
    return Gesture.Race(swipe, times, press);
  }, [canReply, canHold, canRevealTime, offset, pressScale, listSwipe, timeReveal]);

  return (
    <View className={align === "end" ? "max-w-full self-end" : "max-w-[92%] self-start"}>
      {iconShown ? (
        <Animated.View pointerEvents="none" className="absolute bottom-0 top-0 left-0 justify-center" style={iconStyle}>
          <Reply color={muted} size={22} style={MIRROR_IN_RTL} />
        </Animated.View>
      ) : null}
      <GestureDetector gesture={gesture}>
        <Animated.View style={bubbleStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}
