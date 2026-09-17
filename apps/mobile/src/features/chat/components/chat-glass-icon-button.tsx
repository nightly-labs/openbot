import { GlassView } from "expo-glass-effect";
import type { PropsWithChildren } from "react";
import { Pressable, type ViewStyle } from "react-native";

interface ChatGlassButtonProps extends PropsWithChildren {
  accessibilityLabel: string;
  className?: string;
  disabled?: boolean;
  fallbackBackground: ViewStyle["backgroundColor"];
  height?: number;
  liquidGlassAvailable: boolean;
  onPress: () => void;
  width?: number;
}

/** The floating control above the composer: a glass capsule with an icon, a label, or both. */
export function ChatGlassButton({
  accessibilityLabel,
  children,
  className = "flex-1 flex-row items-center justify-center",
  disabled = false,
  fallbackBackground,
  height = 48,
  liquidGlassAvailable,
  onPress,
  width,
}: ChatGlassButtonProps) {
  return (
    <GlassView
      glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
      isInteractive={liquidGlassAvailable && !disabled}
      style={{
        backgroundColor: liquidGlassAvailable ? "transparent" : fallbackBackground,
        borderCurve: "continuous",
        borderRadius: height / 2,
        height,
        overflow: "hidden",
        opacity: disabled ? 0.45 : 1,
        width,
      }}
    >
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        className={className}
        hitSlop={4}
        style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
        onPress={onPress}
      >
        {children}
      </Pressable>
    </GlassView>
  );
}

export function ChatGlassIconButton(props: Omit<ChatGlassButtonProps, "className" | "height" | "width">) {
  return <ChatGlassButton {...props} width={48} />;
}
