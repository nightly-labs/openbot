import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, {
  type CSSTransitionProperties,
  cubicBezier,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";

const GLIDE = 180;
const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
const UPLOAD_SETTLE_MS = GLIDE + 220;
export const UPLOAD_BLUR_RADIUS = 24;

export function useGlidingProgress(progress: number) {
  const reducedMotion = useReducedMotion();
  const value = useSharedValue(progress);
  useEffect(() => {
    value.set(reducedMotion ? progress : withTiming(progress, { duration: GLIDE, easing: Easing.linear }));
  }, [progress, reducedMotion, value]);
  return value;
}

function useUploadRevealStyle(progress: number) {
  const value = useGlidingProgress(progress);
  return useAnimatedStyle(() => ({ opacity: value.get() }));
}

export function useUploadReveal(upload: number | undefined) {
  const [lingering, setLingering] = useState(false);
  useEffect(() => {
    if (upload !== undefined) {
      setLingering(true);
      return;
    }
    const timer = setTimeout(() => setLingering(false), UPLOAD_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [upload]);
  const shownUpload = upload ?? (lingering ? 1 : undefined);
  return { shownUpload, revealStyle: useUploadRevealStyle(shownUpload ?? 1) };
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

export function UploadProgressCircle({ progress }: { progress: number }) {
  const { t } = useText();
  const [accent, track] = useThemeColor(["accent", "border"]);
  const value = useGlidingProgress(progress);
  const done = progress >= 1;
  const arcProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCLE_LENGTH * (1 - value.get()),
    strokeOpacity: value.get() > 0.002 ? 1 : 0,
  }));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={done ? t("mobile.chat.upload.uploaded") : t("mobile.chat.upload.uploadingLabel")}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
      className="items-center justify-center"
      style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE }}
    >
      <Animated.View
        style={{ position: "absolute", opacity: done ? 0 : 1, transform: [{ scale: done ? 0.9 : 1 }], ...CROSSFADE }}
      >
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
