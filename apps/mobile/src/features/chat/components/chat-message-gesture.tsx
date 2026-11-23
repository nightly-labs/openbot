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

const HOLD_MS = 500;
const PRESS_DELAY_MS = 120;
const PRESSED_SCALE = 0.96;
const PRESS_IN = {
  duration: HOLD_MS - PRESS_DELAY_MS,
  easing: Easing.out(Easing.quad),
  reduceMotion: ReduceMotion.System,
};
const RELEASE = { duration: 300, dampingRatio: 0.7, reduceMotion: ReduceMotion.System };
const SETTLE = { duration: 400, dampingRatio: 1, reduceMotion: ReduceMotion.System };
const TIMES_SETTLE = { duration: 450, dampingRatio: 0.78, reduceMotion: ReduceMotion.System };
const TIMES_OVERSCROLL = 0.4;
const REPLY_OVERSCROLL = 0.15;

function resisted(distance: number, limit: number, part: number): number {
  "worklet";
  return Math.max(0, Math.min(distance, limit) + Math.max(0, distance - limit) * part);
}

export function ChatMessageGesture({
  children,
  align = "start",
  selecting,
  onReply,
  onHold,
}: PropsWithChildren<{
  align?: "start" | "end";
  selecting: boolean;
  onReply?: () => void;
  onHold?: () => void;
}>) {
  const muted = useThemeColor("muted");
  const offset = useSharedValue(0);
  const pressScale = useSharedValue(1);
  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.get() * END_X }, { scale: pressScale.get() }],
  }));
  const iconStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, offset.get() / 64) }));
  const [iconShown, setIconShown] = useState(false);
  const handlers = useRef({ onReply, onHold });
  handlers.current = { onReply, onHold };
  const canReply = Boolean(onReply) && !selecting;
  const canHold = Boolean(onHold) && !selecting;
  const listSwipe = useContext(ChatSwipeGestureContext);
  const timeReveal = useContext(ChatTimeRevealContext);
  const canRevealTime = timeReveal !== null && !selecting;
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
