import { Button } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";

import type {
  OnboardingIconButtonProps,
  OnboardingPillButtonProps,
  OnboardingPrimaryButtonProps,
} from "@/features/onboarding/components/onboarding-buttons.types";
import { swapEntering, swapExiting, useOnboardingMotion } from "@/features/onboarding/components/onboarding-motion";
import { readableOn } from "@/features/onboarding/model/onboarding-colors";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";

// Every control beside the main action has its height, so the row reads as one set.
const LARGE = 52;
const REGULAR = 44;

/**
 * Android buttons for the first-run flow: Material shapes and a ripple. The main action is a full
 * pill in the agent's colour (the theme's action colour before there is an agent), the others are
 * tonal; a chosen pill takes the agent's colour.
 */
export function OnboardingPrimaryButton({ label, onPress, disabled = false, color }: OnboardingPrimaryButtonProps) {
  const motion = useOnboardingMotion();
  return (
    <Button
      size="lg"
      feedbackVariant="scale-ripple"
      className={color ? "w-full rounded-full" : "w-full rounded-full bg-action"}
      style={{ height: LARGE, ...(color ? { backgroundColor: color } : null) }}
      isDisabled={disabled}
      accessibilityLabel={label}
      onPress={onPress}
    >
      {/* A new label fades in where the old one fades out. */}
      <LayoutAnimationConfig skipEntering>
        <Animated.View
          key={label}
          entering={swapEntering(motion)}
          exiting={swapExiting(motion)}
          style={{ flexShrink: 1 }}
        >
          <Button.Label
            className={color ? "font-sans font-semibold" : "font-sans font-semibold text-action-foreground"}
            style={color ? { color: readableOn(color) } : undefined}
            numberOfLines={1}
          >
            {label}
          </Button.Label>
        </Animated.View>
      </LayoutAnimationConfig>
    </Button>
  );
}

export function OnboardingIconButton({
  icon: Icon,
  label,
  onPress,
  disabled = false,
  size,
}: OnboardingIconButtonProps) {
  const foreground = String(useThemeColor("foreground"));
  return (
    <Button
      isIconOnly
      variant="secondary"
      feedbackVariant="scale-ripple"
      className="rounded-full"
      style={{ width: size, height: size }}
      isDisabled={disabled}
      accessibilityLabel={label}
      onPress={onPress}
    >
      <Icon size={Math.round(size * 0.42)} color={foreground} strokeWidth={2} style={MIRROR_IN_RTL} />
    </Button>
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
}: OnboardingPillButtonProps) {
  const foreground = String(useThemeColor("foreground"));
  const fill = selected ? color : undefined;
  const text = fill ? readableOn(fill) : foreground;
  return (
    <Button
      variant="secondary"
      feedbackVariant="scale-ripple"
      className="rounded-full px-5"
      style={{ height: size === "large" ? LARGE : REGULAR, ...(fill ? { backgroundColor: fill } : null) }}
      isDisabled={disabled}
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
    >
      {Icon ? <Icon size={16} color={text} strokeWidth={2} /> : null}
      <Button.Label className="font-medium" style={{ color: text }}>
        {label}
      </Button.Label>
    </Button>
  );
}
