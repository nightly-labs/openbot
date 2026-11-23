import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { type TextStyle, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useCSSVariable } from "uniwind";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";

const START_DELAY_MS = 320;
const COUNT_MS = 700;
const TINT_IN_MS = 160;
const TINT_HOLD_MS = 700;
const TINT_OUT_MS = 520;
const POP_SCALE = 1.08;
const POP_IN_MS = 180;
const POP_OUT_MS = 340;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const TENTHS_FORMAT = {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
} as const satisfies Intl.NumberFormatOptions;

export interface CreditCountUpProps {
  value: number;
  from: number | null;
  highlightId: number | null;
  className?: string;
  style?: TextStyle;
  paragraph?: boolean;
  align?: "left" | "right";
  onDone: (id: number) => void;
}

export function CreditCountUp({
  value,
  from,
  highlightId,
  className,
  style,
  paragraph = false,
  align = "left",
  onDone,
}: CreditCountUpProps) {
  const { format } = useText();
  const reducedMotion = useReducedMotion();
  const fill = String(useCSSVariable("--openbot-credit-star-fill"));
  const [shown, setShown] = useState(from ?? value);
  const tint = useSharedValue(0);
  const scale = useSharedValue(1);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (highlightId === null || from === null) {
      setShown(value);
      return;
    }
    const id = highlightId;
    const finish = () => done.current(id);
    const tenthsEnd = value % 1 !== 0;
    const startValue = tenthsEnd ? from : Math.round(from);
    setShown(startValue);
    tint.set(withTiming(1, { duration: TINT_IN_MS, easing: EASE_OUT }));
    const fadeOut = () =>
      tint.set(
        withDelay(
          TINT_HOLD_MS,
          withTiming(0, { duration: TINT_OUT_MS, easing: EASE_OUT }, (finished) => {
            if (finished) scheduleOnRN(finish);
          }),
        ),
      );
    let frame: number | null = null;
    const start = setTimeout(() => {
      if (reducedMotion) {
        setShown(value);
        fadeOut();
        return;
      }
      scale.set(
        withSequence(
          withTiming(POP_SCALE, { duration: POP_IN_MS, easing: EASE_OUT }),
          withTiming(1, { duration: POP_OUT_MS, easing: EASE_OUT }),
        ),
      );
      const startedAt = performance.now();
      const step = () => {
        const progress = Math.min(1, (performance.now() - startedAt) / COUNT_MS);
        const eased = 1 - (1 - progress) ** 3;
        const current = startValue + (value - startValue) * eased;
        setShown(progress < 1 ? (tenthsEnd ? Math.round(current * 10) / 10 : Math.round(current)) : value);
        if (progress < 1) {
          frame = requestAnimationFrame(step);
          return;
        }
        frame = null;
        fadeOut();
      };
      frame = requestAnimationFrame(step);
    }, START_DELAY_MS);
    return () => {
      clearTimeout(start);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [from, highlightId, reducedMotion, scale, tint, value]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const tintStyle = useAnimatedStyle(() => ({ opacity: tint.get() }));
  const counting = highlightId !== null && from !== null;
  const tenths = counting && value % 1 !== 0;
  const numberFormat = tenths ? TENTHS_FORMAT : undefined;
  const text = format.number(shown, numberFormat);
  const ends = counting
    ? [format.number(tenths ? from : Math.round(from), numberFormat), format.number(value, numberFormat)]
    : [text];
  const widest = ends.reduce((longest, candidate) => (candidate.length > longest.length ? candidate : longest), text);
  const label = (color?: string) =>
    paragraph ? (
      <Typography.Paragraph className={className} numberOfLines={1} style={color ? [style, { color }] : style}>
        {text}
      </Typography.Paragraph>
    ) : (
      <Typography className={className} numberOfLines={1} style={color ? [style, { color }] : style}>
        {text}
      </Typography>
    );
  const sizer = paragraph ? (
    <Typography.Paragraph className={className} numberOfLines={1} style={[style, { opacity: 0 }]}>
      {widest}
    </Typography.Paragraph>
  ) : (
    <Typography className={className} numberOfLines={1} style={[style, { opacity: 0 }]}>
      {widest}
    </Typography>
  );
  return (
    <Animated.View style={popStyle}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {sizer}
      </View>
      <View className={align === "left" ? "absolute top-0 left-0" : "absolute top-0 right-0"}>{label()}</View>
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className={align === "left" ? "absolute top-0 left-0" : "absolute top-0 right-0"}
        style={tintStyle}
      >
        {label(fill)}
      </Animated.View>
    </Animated.View>
  );
}
