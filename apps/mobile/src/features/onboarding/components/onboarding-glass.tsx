import { GlassView } from "expo-glass-effect";
import { type ReactNode, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { EASE_OUT_CSS, useOnboardingMotion } from "@/features/onboarding/components/onboarding-motion";
import { useLiquidGlass } from "@/shared/lib/use-liquid-glass";

export function useGlassEntrance(delay: number) {
  const motion = useOnboardingMotion();
  const [ready, setReady] = useState(delay <= 0);
  useEffect(() => {
    if (delay <= 0) return;
    const timer = setTimeout(() => setReady(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);
  const animated = motion !== "none";
  return {
    ready,
    surfaceStyle: {
      transform: [{ scale: ready || motion !== "full" ? 1 : 0.92 }],
      transitionProperty: "transform" as const,
      transitionDuration: animated ? 280 : 0,
      transitionTimingFunction: EASE_OUT_CSS,
    },
    contentStyle: {
      opacity: ready ? 1 : 0,
      transitionProperty: "opacity" as const,
      transitionDuration: animated ? 220 : 0,
      transitionTimingFunction: EASE_OUT_CSS,
    },
  };
}

function Surface({
  radius,
  color,
  tinted,
  interactive,
  appearDelay,
  children,
}: {
  radius: number;
  color: string | undefined;
  tinted: boolean;
  interactive: boolean;
  appearDelay: number;
  children: ReactNode;
}) {
  const glass = useLiquidGlass();
  const entrance = useGlassEntrance(appearDelay);
  return (
    <Animated.View style={entrance.surfaceStyle}>
      <GlassView
        glassEffectStyle={{
          style: glass && entrance.ready ? "regular" : "none",
          animate: true,
          animationDuration: 0.3,
        }}
        tintColor={glass && tinted && color ? `${color}66` : undefined}
        isInteractive={glass && interactive}
        style={{ borderRadius: radius, borderCurve: "continuous", overflow: "hidden" }}
      >
        <Animated.View style={[StyleSheet.absoluteFill, entrance.contentStyle]} pointerEvents="none">
          {glass ? null : (
            <View
              className={tinted && color ? undefined : "bg-grouped"}
              style={[StyleSheet.absoluteFill, tinted && color ? { backgroundColor: `${color}33` } : null]}
            />
          )}
          {!glass && tinted && color ? (
            <View style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1.5, borderColor: color }]} />
          ) : null}
        </Animated.View>
        <Animated.View style={entrance.contentStyle}>{children}</Animated.View>
      </GlassView>
    </Animated.View>
  );
}

export function GlassChoice({
  label,
  hint,
  onPress,
  selected = false,
  disabled = false,
  color,
  radius = 24,
  appearDelay = 0,
  children,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  color?: string;
  radius?: number;
  appearDelay?: number;
  children: ReactNode;
}) {
  return (
    <Surface radius={radius} color={color} tinted={selected} interactive={!disabled} appearDelay={appearDelay}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ selected, disabled }}
        disabled={disabled}
        onPress={onPress}
        android_ripple={{ color: "rgba(127, 127, 127, 0.18)", foreground: true }}
        style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
      >
        {children}
      </Pressable>
    </Surface>
  );
}
