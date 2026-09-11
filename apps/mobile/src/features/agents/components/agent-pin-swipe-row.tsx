import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Pin } from "lucide-react-native";
import type { PropsWithChildren } from "react";
import { Pressable, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { type SharedValue, useAnimatedStyle, useReducedMotion } from "react-native-reanimated";
import { useAppDrawer } from "@/features/servers/components/app-drawer-shell";

import { PIN_COMMIT_DISTANCE, PIN_REVEAL_DISTANCE, useAgentPinSwipe } from "./use-agent-pin-swipe";

function PinAction({
  agentName,
  pinBlocked,
  revealed,
  translation,
  onPress,
}: {
  agentName: string;
  pinBlocked: boolean;
  revealed: boolean;
  translation: SharedValue<number>;
  onPress: () => void;
}) {
  const [accent, accentForeground, danger, dangerForeground] = useThemeColor([
    "accent",
    "accent-foreground",
    "danger",
    "danger-foreground",
  ]);
  const foreground = pinBlocked ? dangerForeground : accentForeground;
  const reducedMotion = useReducedMotion();
  const circleStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: reducedMotion ? 1 : 0.65 + Math.min(1, Math.max(0, -translation.get() / PIN_COMMIT_DISTANCE)) * 0.55 },
    ],
  }));

  const actionStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: Math.min(0, (translation.get() + PIN_REVEAL_DISTANCE) / 2) }],
  }));

  return (
    <Animated.View
      className="w-[88px] items-center justify-center"
      style={actionStyle}
      accessibilityElementsHidden={!revealed}
      importantForAccessibility={revealed ? "auto" : "no-hide-descendants"}
    >
      <Pressable
        accessibilityLabel={`Pin ${agentName}`}
        accessibilityRole="button"
        accessibilityHint={pinBlocked ? "Pin limit reached. Unpin an agent first." : undefined}
        className="size-16 items-center justify-center"
        onPress={onPress}
        style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
      >
        <Animated.View
          pointerEvents="none"
          className="absolute size-16 rounded-full"
          style={[{ backgroundColor: pinBlocked ? danger : accent }, circleStyle]}
        />
        <Pin color={String(foreground)} fill={String(foreground)} size={22} strokeWidth={1.8} />
        <Typography.Paragraph type="body-xs" weight="semibold" style={{ color: foreground }}>
          Pin
        </Typography.Paragraph>
      </Pressable>
    </Animated.View>
  );
}

export function AgentPinSwipeRow({
  agentName,
  pinBlocked,
  onPin,
  children,
}: PropsWithChildren<{ agentName: string; pinBlocked: boolean; onPin: (withHaptic: boolean) => void }>) {
  const [background] = useThemeColor(["background"]);
  const { openingGesture } = useAppDrawer();
  const swipe = useAgentPinSwipe(openingGesture, onPin, pinBlocked);

  return (
    <GestureDetector gesture={swipe.gesture}>
      <ReanimatedSwipeable
        ref={swipe.swipeable}
        enabled={!swipe.pinPending}
        containerStyle={{ backgroundColor: background, overflow: "hidden" }}
        childrenContainerStyle={{ backgroundColor: background }}
        friction={1}
        overshootRight
        overshootFriction={1}
        rightThreshold={PIN_REVEAL_DISTANCE / 2}
        enableTrackpadTwoFingerGesture
        simultaneousWithExternalGesture={swipe.gesture}
        requireExternalGestureToFail={openingGesture}
        onSwipeableWillOpen={swipe.onWillOpen}
        onSwipeableWillClose={swipe.onWillClose}
        onSwipeableClose={swipe.onClose}
        renderRightActions={(_progress, translation) => (
          <PinAction
            revealed={swipe.revealed}
            agentName={agentName}
            pinBlocked={pinBlocked}
            translation={translation}
            onPress={() => swipe.pin()}
          />
        )}
      >
        <View
          pointerEvents={swipe.revealed ? "none" : "auto"}
          accessibilityElementsHidden={swipe.revealed}
          importantForAccessibility={swipe.revealed ? "no-hide-descendants" : "auto"}
        >
          {children}
        </View>
        {swipe.revealed ? (
          <Pressable
            className="absolute inset-0"
            accessibilityRole="button"
            accessibilityLabel={`Close pin action for ${agentName}`}
            onPress={swipe.close}
          />
        ) : null}
      </ReanimatedSwipeable>
    </GestureDetector>
  );
}
