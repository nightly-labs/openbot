import { useThemeColor } from "heroui-native/hooks";
import Reply from "lucide-react-native/icons/reply";
import { type PropsWithChildren, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "@/shared/lib/haptics";

/**
 * A swipe away from the bubble's side of the chat replies: to the right for a bubble at the start,
 * to the left for a bubble at the end. A touch and hold selects text in the bubble. The action row
 * under the message has the same actions, so a screen reader uses that row.
 */
export function ChatMessageGesture({
  children,
  align = "start",
  selecting,
  onReply,
  onSelectText,
}: PropsWithChildren<{
  /** The side of the chat the bubble sits on. */
  align?: "start" | "end";
  /** The text is selected in the bubble: the handles get the touches, not the swipe. */
  selecting: boolean;
  onReply?: () => void;
  onSelectText?: () => void;
}>) {
  const muted = useThemeColor("muted");
  // The swipe distance toward the middle of the chat, in points. A bubble at the end moves left.
  const offset = useSharedValue(0);
  const direction = align === "end" ? -1 : 1;
  const bubbleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() * direction }] }));
  const iconStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, offset.get() / 64) }));
  // The reply icon behind the bubble mounts with the first swipe, not with each row of the chat.
  // It is clear until the bubble has moved, so it shows in time.
  const [iconShown, setIconShown] = useState(false);
  const handlers = useRef({ onReply, onSelectText });
  handlers.current = { onReply, onSelectText };
  const canReply = Boolean(onReply) && !selecting;
  const canSelect = Boolean(onSelectText) && !selecting;
  // Build the gestures once per row. A streaming reply re-renders its row for each chunk, and a new
  // gesture would reconfigure the native handler each time.
  const gesture = useMemo(() => {
    const reply = () => {
      void haptics.impact();
      handlers.current.onReply?.();
    };
    const selectText = () => {
      void haptics.impact();
      handlers.current.onSelectText?.();
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
    const hold = Gesture.LongPress()
      .enabled(canSelect)
      .onStart(() => scheduleOnRN(selectText));
    return Gesture.Race(swipe, hold);
  }, [canReply, canSelect, direction, offset]);

  return (
    <View className={align === "end" ? "max-w-full self-end" : "max-w-[92%] self-start"}>
      {iconShown ? (
        <Animated.View
          pointerEvents="none"
          className={`absolute bottom-0 top-0 justify-center ${align === "end" ? "right-0" : "left-0"}`}
          style={iconStyle}
        >
          <Reply color={muted} size={22} />
        </Animated.View>
      ) : null}
      <GestureDetector gesture={gesture}>
        <Animated.View style={bubbleStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}
