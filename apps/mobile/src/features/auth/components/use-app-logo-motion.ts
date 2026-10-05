import { useCallback, useEffect, useRef } from "react";
import {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { haptics } from "@/shared/lib/haptics";

export type AppLogoAnimation = "none" | "blink";

const VIEWBOX_SIZE = 240;
const BLINK_INTERVAL_MS = 4_800;
const BLINK_START_DELAY_MS = 2_112;
const BLINK_HALF_DURATION_MS = 96;
const BLINK_END_DELAY_MS = BLINK_INTERVAL_MS - BLINK_START_DELAY_MS - BLINK_HALF_DURATION_MS * 2;
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const WINK_DURATION_MS = 360;
const WINK_CLOSE_DURATION_MS = 137;
const WINK_HOLD_DURATION_MS = 72;
const WINK_OPEN_DURATION_MS = WINK_DURATION_MS - WINK_CLOSE_DURATION_MS - WINK_HOLD_DURATION_MS;
const WINK_RIGHT_REACTION_DURATION_MS = 173;
const WINK_RIGHT_RECOVERY_DURATION_MS = WINK_DURATION_MS - WINK_RIGHT_REACTION_DURATION_MS;

function createBlinkAnimation(): number {
  return withRepeat(
    withSequence(
      ReduceMotion.Never,
      withDelay(BLINK_START_DELAY_MS, withTiming(0.08, { duration: BLINK_HALF_DURATION_MS, easing: EASE_IN_OUT })),
      withTiming(1, { duration: BLINK_HALF_DURATION_MS, easing: EASE_IN_OUT }),
      withDelay(BLINK_END_DELAY_MS, withTiming(1, { duration: 0 })),
    ),
    -1,
    false,
    undefined,
    ReduceMotion.Never,
  );
}

export function useAppLogoMotion({ animation, size }: { animation: AppLogoAnimation; size: number }) {
  const reduceMotion = useReducedMotion();
  const leftEyeScaleY = useSharedValue(1);
  const rightEyeScaleX = useSharedValue(1);
  const rightEyeScaleY = useSharedValue(1);
  const rightEyeTranslateY = useSharedValue(0);
  const resumeBlinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopEyeAnimations = useCallback(() => {
    cancelAnimation(leftEyeScaleY);
    cancelAnimation(rightEyeScaleX);
    cancelAnimation(rightEyeScaleY);
    cancelAnimation(rightEyeTranslateY);
  }, [leftEyeScaleY, rightEyeScaleX, rightEyeScaleY, rightEyeTranslateY]);

  const resetEyes = useCallback(() => {
    leftEyeScaleY.set(1);
    rightEyeScaleX.set(1);
    rightEyeScaleY.set(1);
    rightEyeTranslateY.set(0);
  }, [leftEyeScaleY, rightEyeScaleX, rightEyeScaleY, rightEyeTranslateY]);

  const startIdleBlink = useCallback(() => {
    stopEyeAnimations();
    resetEyes();

    if (animation !== "blink" || reduceMotion) return;

    leftEyeScaleY.set(createBlinkAnimation());
    rightEyeScaleY.set(createBlinkAnimation());
  }, [animation, leftEyeScaleY, reduceMotion, resetEyes, rightEyeScaleY, stopEyeAnimations]);

  useEffect(() => {
    startIdleBlink();

    return () => {
      if (resumeBlinkTimer.current) clearTimeout(resumeBlinkTimer.current);
      stopEyeAnimations();
    };
  }, [startIdleBlink, stopEyeAnimations]);

  const handlePressIn = useCallback(() => {
    void haptics.impact();

    if (resumeBlinkTimer.current) clearTimeout(resumeBlinkTimer.current);
    stopEyeAnimations();
    resetEyes();

    if (!reduceMotion) {
      leftEyeScaleY.set(
        withSequence(
          ReduceMotion.Never,
          withTiming(0.08, { duration: WINK_CLOSE_DURATION_MS, easing: EASE_OUT }),
          withDelay(WINK_HOLD_DURATION_MS, withTiming(0.08, { duration: 0 })),
          withTiming(1, { duration: WINK_OPEN_DURATION_MS, easing: EASE_OUT }),
        ),
      );
      rightEyeScaleX.set(
        withSequence(
          ReduceMotion.Never,
          withTiming(0.96, { duration: WINK_RIGHT_REACTION_DURATION_MS, easing: EASE_OUT }),
          withTiming(1, { duration: WINK_RIGHT_RECOVERY_DURATION_MS, easing: EASE_OUT }),
        ),
      );
      rightEyeScaleY.set(
        withSequence(
          ReduceMotion.Never,
          withTiming(1.08, { duration: WINK_RIGHT_REACTION_DURATION_MS, easing: EASE_OUT }),
          withTiming(1, { duration: WINK_RIGHT_RECOVERY_DURATION_MS, easing: EASE_OUT }),
        ),
      );
      rightEyeTranslateY.set(
        withSequence(
          ReduceMotion.Never,
          withTiming(-2.4, { duration: WINK_RIGHT_REACTION_DURATION_MS, easing: EASE_OUT }),
          withTiming(0, { duration: WINK_RIGHT_RECOVERY_DURATION_MS, easing: EASE_OUT }),
        ),
      );
    }

    resumeBlinkTimer.current = setTimeout(startIdleBlink, WINK_DURATION_MS);
  }, [
    leftEyeScaleY,
    reduceMotion,
    resetEyes,
    rightEyeScaleX,
    rightEyeScaleY,
    rightEyeTranslateY,
    startIdleBlink,
    stopEyeAnimations,
  ]);

  const leftEyeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: leftEyeScaleY.get() }],
  }));
  const rightEyeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: (rightEyeTranslateY.get() * size) / VIEWBOX_SIZE },
      { scaleX: rightEyeScaleX.get() },
      { scaleY: rightEyeScaleY.get() },
    ],
  }));
  return { handlePressIn, leftEyeAnimatedStyle, rightEyeAnimatedStyle };
}
