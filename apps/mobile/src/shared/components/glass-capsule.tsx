import { GlassView } from "expo-glass-effect";
import type { PropsWithChildren } from "react";
import { Platform } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { isAndroid } from "@/shared/lib/platform";

/** The height of the bottom search capsules: home search and the Marketplace field. */
export const GLASS_CAPSULE_HEIGHT = 52;
const CSS_EASE_SMOOTH = cubicBezier(0.32, 0.72, 0, 1);
/** How long a tint takes to come in and to go, as the task result of home search. */
const TINT_IN = 380;
const TINT_OUT = 280;

/** The shadow of the solid capsule. */
const CAPSULE_SHADOW = "0 6px 18px rgba(0, 0, 0, 0.07)";
/** Android 12 and later can blur the content under a view, as the bar header does. */
export const ANDROID_BLUR = isAndroid && Number(Platform.Version) >= 31;

/** Glass where the system has it; a solid capsule elsewhere, and with Reduce Transparency on. */
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
  /** A capsule beside the chat composer takes its resting height, so the two match. */
  height?: number;
  /**
   * A color over the glass, such as the agent color of a task result. Pass it before it shows, so the
   * tint is mounted and fades in.
   */
  tint?: string;
  /** False fades the tint out. The tint keeps its color while it fades. */
  tintShown?: boolean;
  /** The glass comes and goes with the native glass animation, for a capsule that mounts on screen. */
  animateGlass?: boolean;
  /** With `animateGlass`: the glass dissolves before the capsule unmounts. */
  glassHidden?: boolean;
}>) {
  // Android has no glass: the capsule is plain, with the fill of the chat composer and its buttons.
  // iOS without Liquid Glass, or with Reduce Transparency, keeps the solid capsule with its shadow.
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
      {/* The tint lies over the glass, as in the prototype. The native glass tint cannot animate, and
          the tint must fade in and out with the result. */}
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
