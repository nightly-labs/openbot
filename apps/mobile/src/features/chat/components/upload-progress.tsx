import { useThemeColor } from "heroui-native/hooks";
import { Check } from "lucide-react-native";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  type CSSTransitionProperties,
  cubicBezier,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

// Between two reported percents the value glides for this long, so it never ticks.
const GLIDE = 180;
const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
/** How long a finished upload needs to settle. Its owner keeps the upload view mounted this long. */
export const UPLOAD_SETTLE_MS = GLIDE + 220;
/** How far the blurred copy is blurred. Enough to hide detail, not so much that the shape goes. */
export const UPLOAD_BLUR_RADIUS = 24;

/**
 * The sent fraction of an upload, gliding between reports on the UI thread. The host reports
 * bytes that have left the phone, so the value is measured, not guessed.
 */
function useGlidingProgress(progress: number) {
  const reducedMotion = useReducedMotion();
  const value = useSharedValue(progress);
  useEffect(() => {
    value.set(reducedMotion ? progress : withTiming(progress, { duration: GLIDE, easing: Easing.linear }));
  }, [progress, reducedMotion, value]);
  return value;
}

/**
 * The style of the sharp image over its blurred copy. It is as opaque as the upload is complete,
 * so the photo comes into focus as it leaves the phone. Only opacity moves: the blur itself is a
 * static layer, and redrawing a blur every frame is what makes a phone stutter.
 */
export function useUploadRevealStyle(progress: number) {
  const value = useGlidingProgress(progress);
  return useAnimatedStyle(() => ({ opacity: value.get() }));
}

const CIRCLE_SIZE = 22;
const CIRCLE_STROKE = 2.5;
const CIRCLE_RADIUS = (CIRCLE_SIZE - CIRCLE_STROKE) / 2;
const CIRCLE_LENGTH = 2 * Math.PI * CIRCLE_RADIUS;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const CROSSFADE: CSSTransitionProperties = {
  transitionProperty: ["opacity", "transform"],
  transitionDuration: 200,
  transitionTimingFunction: EASE_OUT,
};

/** A small circle beside a file that fills as it uploads, and becomes a check when it is done. */
export function UploadProgressCircle({ progress }: { progress: number }) {
  const [accent, track] = useThemeColor(["accent", "border"]);
  const value = useGlidingProgress(progress);
  const done = progress >= 1;
  const arcProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCLE_LENGTH * (1 - value.get()),
    // A round cap draws a dot even for an empty arc, so the arc waits for the first byte.
    strokeOpacity: value.get() > 0.002 ? 1 : 0,
  }));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={done ? "Uploaded" : "Uploading"}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
      className="items-center justify-center"
      style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE }}
    >
      <Animated.View
        style={{ position: "absolute", opacity: done ? 0 : 1, transform: [{ scale: done ? 0.9 : 1 }], ...CROSSFADE }}
      >
        {/* Turned a quarter, so the arc starts at the top and runs clockwise. */}
        <Svg width={CIRCLE_SIZE} height={CIRCLE_SIZE} style={{ transform: [{ rotate: "-90deg" }] }}>
          <Circle
            cx={CIRCLE_SIZE / 2}
            cy={CIRCLE_SIZE / 2}
            r={CIRCLE_RADIUS}
            stroke={track}
            strokeWidth={CIRCLE_STROKE}
            fill="none"
          />
          <AnimatedCircle
            cx={CIRCLE_SIZE / 2}
            cy={CIRCLE_SIZE / 2}
            r={CIRCLE_RADIUS}
            stroke={accent}
            strokeWidth={CIRCLE_STROKE}
            strokeLinecap="round"
            strokeDasharray={[CIRCLE_LENGTH, CIRCLE_LENGTH]}
            fill="none"
            animatedProps={arcProps}
          />
        </Svg>
      </Animated.View>
      <Animated.View style={{ opacity: done ? 1 : 0, transform: [{ scale: done ? 1 : 0.9 }], ...CROSSFADE }}>
        <Check size={16} strokeWidth={2.6} color={String(accent)} />
      </Animated.View>
    </View>
  );
}
