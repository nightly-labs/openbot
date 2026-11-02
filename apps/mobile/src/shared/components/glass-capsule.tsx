import { BlurView } from "expo-blur";
import { GlassView } from "expo-glass-effect";
import type { PropsWithChildren, RefObject } from "react";
import { Platform, StyleSheet, View, type ViewInstance } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { useCSSVariable, useUniwind } from "uniwind";
import { ChromeGlassSheen } from "@/shared/components/chrome-glass-sheen";
import { useChromeGlass } from "@/shared/lib/chrome-glass";
import { isAndroid } from "@/shared/lib/platform";

/** The height of the bottom search capsules: home search and the Marketplace field. */
export const GLASS_CAPSULE_HEIGHT = 52;
const CSS_EASE_SMOOTH = cubicBezier(0.32, 0.72, 0, 1);
/** How long a tint takes to come in and to go, as the task result of home search. */
const TINT_IN = 380;
const TINT_OUT = 280;

/** The shadow of the solid capsule. */
const CAPSULE_SHADOW = "0 6px 18px rgba(0, 0, 0, 0.07)";
/** The blur radius of the Android capsule, near the 18 px of the design; the native limit is 25. */
const BLUR_RADIUS = 24;
/** Android 12 and later draw the blur. Earlier versions keep the solid glass. */
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
  blurTarget,
  blurPaused = false,
  children,
}: PropsWithChildren<{
  liquidGlass: boolean;
  /** Android: the content to blur under the capsule. Without it the capsule has the solid glass. */
  blurTarget?: RefObject<ViewInstance | null>;
  /** Shows the solid glass over the blur, for a time when the target is not under the capsule. */
  blurPaused?: boolean;
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
  // Android has no glass: the capsule blurs the content under it and lays the milky fill of the
  // design over the blur. iOS without Liquid Glass, or with Reduce Transparency, keeps the solid capsule.
  const milky = useChromeGlass();
  const { theme } = useUniwind();
  const blurFill = String(useCSSVariable("--openbot-bg-chrome-blur"));
  const blurs = ANDROID_BLUR && !liquidGlass && blurTarget !== undefined && !blurPaused;
  const fallback = isAndroid ? milky : { backgroundColor: String(fallbackBackground), boxShadow: CAPSULE_SHADOW };
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
        // The fill lies in its own layer over the blur.
        isAndroid && !liquidGlass ? { backgroundColor: "transparent" } : null,
        {
          borderCurve: "continuous",
          borderRadius: height / 2,
          height,
          overflow: "hidden",
          width,
        },
      ]}
    >
      {isAndroid && !liquidGlass ? (
        // The blur stays mounted while the field is solid: a `BlurView` that mounts paints its tint
        // and the window background for a frame. The solid fill then covers it, and the blur method
        // `none` stops the blur, which otherwise blurs the whole target on each frame that it changes.
        <>
          {ANDROID_BLUR && blurTarget ? (
            <BlurView
              blurTarget={blurTarget}
              blurMethod={blurs ? "dimezisBlurViewSdk31Plus" : "none"}
              intensity={BLUR_RADIUS}
              blurReductionFactor={1}
              tint={theme === "dark" ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: blurs ? blurFill : milky.backgroundColor }]}
          />
          <ChromeGlassSheen />
        </>
      ) : null}
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
