import * as Haptics from "expo-haptics";
import { useThemeColor } from "heroui-native/hooks";
import { Reply } from "lucide-react-native";
import type { PropsWithChildren } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

export function ChatMessageGesture({
  children,
  onReply,
  onOpenActions,
}: PropsWithChildren<{
  onReply?: () => void;
  onOpenActions: () => void;
}>) {
  const muted = useThemeColor("muted");
  const offset = useSharedValue(0);
  const bubbleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));
  const iconStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, offset.get() / 64) }));
  const reply = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onReply?.();
  };
  const openActions = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onOpenActions();
  };
  const swipe = Gesture.Pan()
    .enabled(Boolean(onReply))
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

  return (
    <View className="max-w-[88%] self-start">
      <Animated.View pointerEvents="none" className="absolute bottom-0 left-0 top-0 justify-center" style={iconStyle}>
        <Reply color={muted} size={22} />
      </Animated.View>
      <GestureDetector gesture={Gesture.Race(swipe, hold)}>
        <Animated.View
          style={bubbleStyle}
          accessible
          accessibilityRole="text"
          accessibilityActions={[
            { name: "longpress", label: "Message actions" },
            ...(onReply ? [{ name: "reply", label: "Reply" }] : []),
          ]}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === "reply" && onReply) reply();
            else if (nativeEvent.actionName === "longpress") openActions();
          }}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
