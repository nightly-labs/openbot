import { type GlassColorScheme, GlassView } from "expo-glass-effect";
import type { PropsWithChildren } from "react";
import { type AccessibilityValue, Pressable, type ViewStyle } from "react-native";
import Animated, { type CSSTransitionProperties, cubicBezier } from "react-native-reanimated";

const FADE: CSSTransitionProperties = {
  transitionProperty: "opacity",
  transitionDuration: 200,
  transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
};

interface ChatGlassButtonProps extends PropsWithChildren {
  accessibilityLabel: string;
  accessibilityValue?: AccessibilityValue;
  className?: string;
  colorScheme?: GlassColorScheme;
  disabled?: boolean;
  fallbackBackground: ViewStyle["backgroundColor"];
  height?: number;
  hidden?: boolean;
  liquidGlassAvailable: boolean;
  onPress: () => void;
  width?: number;
}

export function ChatGlassButton({
  accessibilityLabel,
  accessibilityValue,
  children,
  className = "flex-1 flex-row items-center justify-center",
  colorScheme,
  disabled = false,
  fallbackBackground,
  height = 48,
  hidden,
  liquidGlassAvailable,
  onPress,
  width,
}: ChatGlassButtonProps) {
  return (
    <GlassView
      glassEffectStyle={{
        style: liquidGlassAvailable && !hidden ? "regular" : "none",
        animate: true,
        animationDuration: 0.2,
      }}
      colorScheme={colorScheme}
      isInteractive={liquidGlassAvailable && !disabled && !hidden}
      pointerEvents={hidden ? "none" : "auto"}
      style={{
        backgroundColor: "transparent",
        borderCurve: "continuous",
        borderRadius: height / 2,
        height,
        overflow: "hidden",
        opacity: disabled ? 0.45 : 1,
        width,
      }}
    >
      {liquidGlassAvailable ? null : (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: fallbackBackground,
            opacity: hidden ? 0 : 1,
            ...FADE,
          }}
        />
      )}
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={accessibilityValue}
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        className={className}
        hitSlop={4}
        style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
        onPress={onPress}
      >
        {hidden === undefined ? (
          children
        ) : (
          <Animated.View style={{ opacity: hidden ? 0 : 1, ...FADE }}>{children}</Animated.View>
        )}
      </Pressable>
    </GlassView>
  );
}

export function ChatGlassLabel({
  children,
  colorScheme,
  fallbackBackground,
  height = 48,
  hidden,
  liquidGlassAvailable,
}: Pick<
  ChatGlassButtonProps,
  "children" | "colorScheme" | "fallbackBackground" | "height" | "hidden" | "liquidGlassAvailable"
>) {
  return (
    <GlassView
      glassEffectStyle={{
        style: liquidGlassAvailable && !hidden ? "regular" : "none",
        animate: true,
        animationDuration: 0.2,
      }}
      colorScheme={colorScheme}
      isInteractive={false}
      pointerEvents="none"
      style={{
        backgroundColor: "transparent",
        borderCurve: "continuous",
        borderRadius: height / 2,
        height,
        justifyContent: "center",
        overflow: "hidden",
        paddingHorizontal: 16,
      }}
    >
      {liquidGlassAvailable ? null : (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: fallbackBackground,
            opacity: hidden ? 0 : 1,
            ...FADE,
          }}
        />
      )}
      <Animated.View style={{ opacity: hidden ? 0 : 1, ...FADE }}>{children}</Animated.View>
    </GlassView>
  );
}

export function ChatGlassIconButton(props: Omit<ChatGlassButtonProps, "className" | "height" | "width">) {
  return <ChatGlassButton {...props} width={48} />;
}
