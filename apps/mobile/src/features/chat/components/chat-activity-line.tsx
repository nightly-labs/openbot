import { Typography } from "heroui-native";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import { type ReactNode, useState } from "react";
import { type AccessibilityState, Pressable, View } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { useCSSVariable } from "uniwind";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";

export const ACTIVITY_ICON_SIZE = 14;
export const CHEVRON_SIZE = 12;
const PRESS_EASING = cubicBezier(0.23, 1, 0.32, 1);

export type ActivityColors = {
  muted: string;
  dim: string;
  name: string;
  danger: string;
  running: string;
};

export function useActivityColors(): ActivityColors {
  const [muted, dim, name, danger, running] = useCSSVariable([
    "--openbot-text-muted",
    "--openbot-text-dim",
    "--openbot-text-secondary",
    "--openbot-danger-text",
    "--openbot-accent-text",
  ]);
  return {
    muted: String(muted),
    dim: String(dim),
    name: String(name),
    danger: String(danger),
    running: String(running),
  };
}

export function ChatActivityLine({
  icon,
  label,
  name,
  nameIcon,
  meta,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  trailing,
  onPress,
}: {
  icon: ReactNode;
  label?: string;
  name?: string;
  nameIcon?: ReactNode;
  meta?: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
  trailing?: ReactNode;
  onPress?: () => void;
}) {
  const colors = useActivityColors();
  const reducedMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const content = (
    <>
      {icon}
      {label ? (
        <Typography.Paragraph
          type="body-xs"
          numberOfLines={1}
          className="shrink"
          style={{ color: colors.muted, fontVariant: ["tabular-nums"] }}
        >
          {label}
        </Typography.Paragraph>
      ) : null}
      {nameIcon}
      {name ? (
        <Typography.Paragraph
          type="body-xs"
          numberOfLines={2}
          className="shrink font-medium"
          style={{ color: colors.name }}
        >
          {name}
        </Typography.Paragraph>
      ) : null}
      {meta ? (
        <Typography.Paragraph
          type="body-xs"
          numberOfLines={1}
          className="shrink"
          style={{ color: colors.dim, fontVariant: ["tabular-nums"] }}
        >
          {`· ${meta}`}
        </Typography.Paragraph>
      ) : null}
      {trailing ?? (onPress ? <ChevronRight size={CHEVRON_SIZE} color={colors.dim} style={MIRROR_IN_RTL} /> : null)}
    </>
  );
  if (!onPress)
    return (
      <View
        accessible
        accessibilityLabel={accessibilityLabel}
        className="max-w-full flex-row items-center gap-1.5 self-start px-1 py-1"
      >
        {content}
      </View>
    );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState}
      hitSlop={8}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={() => {
        void haptics.selection();
        onPress();
      }}
      className="max-w-full self-start"
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
        {content}
      </Animated.View>
    </Pressable>
  );
}

export function ExpandChevron({ open }: { open: boolean }) {
  const colors = useActivityColors();
  const reducedMotion = useReducedMotion();
  return (
    <Animated.View
      style={{
        transform: [{ rotate: open ? "180deg" : "0deg" }],
        transitionProperty: "transform",
        transitionDuration: reducedMotion ? 0 : 160,
        transitionTimingFunction: PRESS_EASING,
      }}
    >
      <ChevronDown size={CHEVRON_SIZE} color={colors.dim} strokeWidth={2} />
    </Animated.View>
  );
}
