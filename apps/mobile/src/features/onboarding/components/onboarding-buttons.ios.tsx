import { GlassView } from "expo-glass-effect";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";
import { useCSSVariable } from "uniwind";

import type {
  OnboardingIconButtonProps,
  OnboardingPillButtonProps,
  OnboardingPrimaryButtonProps,
} from "@/features/onboarding/components/onboarding-buttons.types";
import { useGlassEntrance } from "@/features/onboarding/components/onboarding-glass";
import { swapEntering, swapExiting, useOnboardingMotion } from "@/features/onboarding/components/onboarding-motion";
import { readableOn } from "@/features/onboarding/model/onboarding-colors";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { useLiquidGlass } from "@/shared/lib/use-liquid-glass";

// Every control beside the main action has its height, so the row reads as one set.
const LARGE = 52;
const REGULAR = 44;
const DISABLED_OPACITY = 0.45;

/**
 * One iOS glass control. React Native lays it out, so it takes exactly the size it is given, and
 * the label sits on the glass rather than inside a glass effect, which would lighten dark text.
 * Without Liquid Glass (older iOS, Reduce Transparency), a solid fill takes the glass's place.
 */
function GlassControl({
  label,
  onPress,
  disabled,
  fill,
  height,
  width,
  selected,
  appearDelay = 0,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  appearDelay?: number;
  /** A colour for the glass, or none for clear glass. */
  fill: string | undefined;
  height: number;
  width?: number | "100%";
  selected?: boolean;
  children: ReactNode;
}) {
  const glass = useLiquidGlass();
  const entrance = useGlassEntrance(appearDelay);
  // Glass does not draw under a parent with less than full opacity, and does not come back after
  // it. A disabled control keeps its glass: only its label dims and its colour pales.
  const tint = fill && disabled && /^#[0-9a-f]{6}$/i.test(fill) ? `${fill}73` : fill;
  return (
    <Animated.View style={[{ width }, entrance.surfaceStyle]}>
      <GlassView
        glassEffectStyle={{
          style: glass && entrance.ready ? "regular" : "none",
          animate: true,
          animationDuration: 0.3,
        }}
        tintColor={glass ? tint : undefined}
        isInteractive={glass && !disabled}
        style={{
          width,
          height,
          borderRadius: height / 2,
          borderCurve: "continuous",
          overflow: "hidden",
        }}
      >
        {glass ? null : (
          <Animated.View
            pointerEvents="none"
            className={fill ? undefined : "bg-grouped"}
            style={[StyleSheet.absoluteFill, tint ? { backgroundColor: tint } : null, entrance.contentStyle]}
          />
        )}
        <Animated.View style={[{ flex: 1, opacity: disabled ? DISABLED_OPACITY : 1 }, entrance.contentStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled, selected }}
            disabled={disabled}
            hitSlop={4}
            onPress={onPress}
            className="flex-1 flex-row items-center justify-center gap-1.5"
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            {children}
          </Pressable>
        </Animated.View>
      </GlassView>
    </Animated.View>
  );
}

export function OnboardingPrimaryButton({
  label,
  onPress,
  disabled = false,
  color,
  appearDelay,
}: OnboardingPrimaryButtonProps) {
  const motion = useOnboardingMotion();
  const action = String(useCSSVariable("--openbot-action") ?? "#f0f0f0");
  const actionForeground = String(useCSSVariable("--openbot-action-foreground") ?? "#141414");
  return (
    <GlassControl
      label={label}
      onPress={onPress}
      disabled={disabled}
      fill={color ?? action}
      height={LARGE}
      width="100%"
      appearDelay={appearDelay}
    >
      {/* A new label fades in where the old one fades out. The glass stays. */}
      <LayoutAnimationConfig skipEntering>
        <Animated.View
          key={label}
          entering={swapEntering(motion)}
          exiting={swapExiting(motion)}
          style={{ flexShrink: 1 }}
        >
          <Typography
            numberOfLines={1}
            className="px-5 font-sans font-semibold text-[17px]"
            style={{ color: color ? readableOn(color) : actionForeground }}
          >
            {label}
          </Typography>
        </Animated.View>
      </LayoutAnimationConfig>
    </GlassControl>
  );
}

export function OnboardingIconButton({
  icon: Icon,
  label,
  onPress,
  disabled = false,
  size,
  appearDelay,
}: OnboardingIconButtonProps) {
  const foreground = String(useThemeColor("foreground"));
  return (
    <GlassControl
      label={label}
      onPress={onPress}
      disabled={disabled}
      fill={undefined}
      height={size}
      width={size}
      appearDelay={appearDelay}
    >
      <Icon size={Math.round(size * 0.42)} color={foreground} strokeWidth={2} style={MIRROR_IN_RTL} />
    </GlassControl>
  );
}

export function OnboardingPillButton({
  label,
  onPress,
  icon: Icon,
  disabled = false,
  selected = false,
  color,
  size = "regular",
  appearDelay,
}: OnboardingPillButtonProps) {
  const foreground = String(useThemeColor("foreground"));
  const fill = selected ? color : undefined;
  const text = fill ? readableOn(fill) : foreground;
  return (
    <GlassControl
      label={label}
      onPress={onPress}
      disabled={disabled}
      fill={fill}
      selected={selected}
      height={size === "large" ? LARGE : REGULAR}
      appearDelay={appearDelay}
    >
      <View className="flex-row items-center gap-1.5 px-5">
        {Icon ? <Icon size={16} color={text} strokeWidth={2} /> : null}
        <Typography numberOfLines={1} className="font-sans font-medium text-[16px]" style={{ color: text }}>
          {label}
        </Typography>
      </View>
    </GlassControl>
  );
}
