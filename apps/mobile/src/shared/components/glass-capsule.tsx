import { GlassView } from "expo-glass-effect";
import type { PropsWithChildren } from "react";
import { Platform } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { isAndroid } from "@/shared/lib/platform";

export const GLASS_CAPSULE_HEIGHT = 52;
const CSS_EASE_SMOOTH = cubicBezier(0.32, 0.72, 0, 1);
const TINT_IN = 380;
const TINT_OUT = 280;

const CAPSULE_SHADOW = "0 6px 18px rgba(0, 0, 0, 0.07)";
export const ANDROID_BLUR = isAndroid && Number(Platform.Version) >= 31;

export function GlassCapsule({
  liquidGlass,
  fallbackBackground,
  width,
  height = GLASS_CAPSULE_HEIGHT,
  animateGlass = false,
  glassHidden = false,
  tint,
  tintShown = true,
  children,
}: PropsWithChildren<{
  liquidGlass: boolean;
  fallbackBackground: unknown;
  width?: number;
  height?: number;
  tint?: string;
  tintShown?: boolean;
  animateGlass?: boolean;
  glassHidden?: boolean;
}>) {
  const fallback = {
    backgroundColor: String(fallbackBackground),
    boxShadow: isAndroid ? undefined : CAPSULE_SHADOW,
  };
  return (
    <GlassView
      glassEffectStyle={
        animateGlass
          ? { style: liquidGlass && !glassHidden ? "regular" : "none", animate: true, animationDuration: 0.36 }
          : liquidGlass
            ? "regular"
            : "none"
      }
      isInteractive={liquidGlass}
      style={[
        liquidGlass ? { backgroundColor: "transparent" } : fallback,
        {
          borderCurve: "continuous",
          borderRadius: height / 2,
          height,
          overflow: "hidden",
          width,
        },
      ]}
    >
      {tint ? (
        <Animated.View
          pointerEvents="none"
          className="absolute inset-0"
          style={{
            backgroundColor: tint,
            borderCurve: "continuous",
            borderRadius: GLASS_CAPSULE_HEIGHT / 2,
            opacity: tintShown ? 1 : 0,
            transitionProperty: "opacity",
            transitionDuration: tintShown ? TINT_IN : TINT_OUT,
            transitionTimingFunction: CSS_EASE_SMOOTH,
          }}
        />
      ) : null}
      {children}
    </GlassView>
  );
}
