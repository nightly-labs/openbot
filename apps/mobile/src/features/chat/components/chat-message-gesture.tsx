import { Button } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Reply } from "lucide-react-native";
import { type PropsWithChildren, useMemo, useRef } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function ChatMessageGesture({
  children,
  screenReaderEnabled,
  onReply,
  onOpenActions,
}: PropsWithChildren<{
  screenReaderEnabled: boolean;
  onReply?: () => void;
  onOpenActions: () => void;
}>) {
  const muted = useThemeColor("muted");
  const { t } = useText();
  const offset = useSharedValue(0);
  const bubbleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));
  const iconStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, offset.get() / 64) }));
  const handlers = useRef({ onReply, onOpenActions });
  handlers.current = { onReply, onOpenActions };
  const canReply = Boolean(onReply);
  // Build the gestures once per row. A streaming reply re-renders its row for each chunk, and a new
  // gesture would reconfigure the native handler each time.
  const { gesture, reply, openActions } = useMemo(() => {
    const reply = () => {
      void haptics.impact();
      handlers.current.onReply?.();
    };
    const openActions = () => {
      void haptics.impact();
      handlers.current.onOpenActions();
    };
    const swipe = Gesture.Pan()
      .enabled(canReply)
      .activeOffsetX(16)
      .failOffsetX(-8)
      .failOffsetY([-12, 12])
      .onUpdate((event) => {
        offset.set(Math.max(0, Math.min(event.translationX, 64) + Math.max(0, event.translationX - 64) * 0.15));
      })
      .onEnd((event) => {
        if (event.translationX >= 64 || (event.translationX >= 24 && event.velocityX >= 650)) scheduleOnRN(reply);
      })
      .onFinalize(() => {
        offset.set(withSpring(0, { duration: 400, dampingRatio: 1, reduceMotion: ReduceMotion.System }));
      });
    const hold = Gesture.LongPress().onStart(() => scheduleOnRN(openActions));
    return { gesture: Gesture.Race(swipe, hold), reply, openActions };
  }, [canReply, offset]);

  return (
    <View className="max-w-[88%] self-start">
      <Animated.View pointerEvents="none" className="absolute bottom-0 left-0 top-0 justify-center" style={iconStyle}>
        <Reply color={muted} size={22} />
      </Animated.View>
      <GestureDetector gesture={gesture}>
        <Animated.View style={bubbleStyle}>
          {children}
          {screenReaderEnabled ? (
            <Button
              variant="ghost"
              onPress={openActions}
              accessibilityActions={onReply ? [{ name: "reply", label: t("mobile.chat.message.reply") }] : []}
              onAccessibilityAction={({ nativeEvent }) => {
                if (nativeEvent.actionName === "reply" && onReply) reply();
              }}
            >
              <Button.Label>{t("mobile.chat.message.actions")}</Button.Label>
            </Button>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
