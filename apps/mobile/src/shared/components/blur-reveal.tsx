import { BlurTargetView, BlurView } from "expo-blur";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { StyleSheet, type View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/** Retain outgoing content until its exit animation finishes. */
export function BlurReveal<T>({
  value,
  children,
  collapseOnHide = false,
  interactive = false,
  enterDuration = 240,
  exitDuration = 180,
  enterDelay = 0,
}: {
  value: T | null;
  children: (value: T) => ReactNode;
  collapseOnHide?: boolean;
  interactive?: boolean;
  enterDuration?: number;
  exitDuration?: number;
  /** Waits before the entrance, so several reveals can come in one after another. */
  enterDelay?: number;
}) {
  const [retained, setRetained] = useState(value);
  const target = useRef<View | null>(null);
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const visible = value !== null;

  useEffect(() => {
    if (value !== null) setRetained(value);
  }, [value]);

  useEffect(() => {
    let cancelled = false;
    const clearRetained = () => {
      if (!cancelled) setRetained(null);
    };
    progress.set(
      withDelay(
        visible ? enterDelay : 0,
        withTiming(
          visible ? 1 : 0,
          {
            duration: visible ? enterDuration : exitDuration,
            easing: EASE_OUT,
            reduceMotion: ReduceMotion.System,
          },
          (finished) => {
            if (finished && !visible && collapseOnHide) scheduleOnRN(clearRetained);
          },
        ),
        ReduceMotion.System,
      ),
    );
    return () => {
      cancelled = true;
    };
  }, [collapseOnHide, enterDelay, enterDuration, exitDuration, progress, visible]);

  const contentStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: reduceMotion ? 0 : (1 - progress.get()) * 3 }],
  }));
  const blurStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0 : 1 - progress.get(),
  }));
  const displayed = value ?? retained;
  if (displayed === null) return null;

  return (
    <Animated.View
      pointerEvents={interactive && visible ? "auto" : "none"}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      style={contentStyle}
    >
      <BlurTargetView ref={target}>{children(displayed)}</BlurTargetView>
      {!reduceMotion ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, blurStyle]}>
          <BlurView
            blurTarget={target}
            blurMethod="dimezisBlurViewSdk31Plus"
            intensity={16}
            tint="systemUltraThinMaterial"
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
