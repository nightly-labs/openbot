import { Typography } from "heroui-native";
import Brain from "lucide-react-native/icons/brain";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import { useState } from "react";
import { type ColorValue, Pressable } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { type MobileText, useText } from "@/shared/lib/text";
import type { TurnStepsSummary } from "../model/turn-thinking";

const PRESS_EASING = cubicBezier(0.23, 1, 0.32, 1);

/** "12s" or "1m 04s". */
export function turnDuration(seconds: number, { t, format }: Pick<MobileText, "t" | "format">): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return t("mobile.chat.thinking.seconds", { seconds: format.number(total) });
  return t("mobile.chat.thinking.minutes", {
    minutes: format.number(Math.floor(total / 60)),
    seconds: String(total % 60).padStart(2, "0"),
  });
}

/** The row above a finished answer: how long the turn took and its step count. It opens the steps. */
export function ChatTurnStepsRow({
  summary,
  muted,
  onPress,
}: {
  summary: TurnStepsSummary;
  muted: ColorValue;
  onPress: () => void;
}) {
  const text = useText();
  const reducedMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const steps = text.t("mobile.chat.thinking.steps", { count: summary.steps });
  const label =
    summary.seconds === null
      ? steps
      : text.t("mobile.chat.thinking.summary", { duration: turnDuration(summary.seconds, text), steps });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={text.t("mobile.chat.thinking.openHint")}
      hitSlop={8}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={() => {
        void haptics.selection();
        onPress();
      }}
      className="self-start"
    >
      <Animated.View
        className="flex-row items-center gap-1.5 px-1 py-1"
        style={{
          transform: [{ scale: pressed && !reducedMotion ? 0.97 : 1 }],
          transitionProperty: "transform",
          transitionDuration: 120,
          transitionTimingFunction: PRESS_EASING,
        }}
      >
        <Brain size={14} color={muted} />
        <Typography.Paragraph type="body-xs" className="text-muted" numberOfLines={1}>
          {label}
        </Typography.Paragraph>
        <ChevronRight size={14} color={muted} />
      </Animated.View>
    </Pressable>
  );
}
