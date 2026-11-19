import { type PropsWithChildren, useState } from "react";
import type { ViewStyle } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { useReducedMotion } from "@/shared/lib/motion";

const EASING = cubicBezier(0.23, 1, 0.32, 1);
const BAR_MS = 240;
const VALUE_MS = 220;
const LOADING_MS = 160;
const VALUE_IN = {
  from: { opacity: 0.2, transform: [{ translateY: 6 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }] },
};
const VALUE_FADE = { from: { opacity: 0.2 }, to: { opacity: 1 } };

export function UsageValue({ value, children }: PropsWithChildren<{ value: string }>) {
  const reducedMotion = useReducedMotion();
  const [initial] = useState(value);
  return (
    <Animated.View
      key={value}
      style={
        value === initial
          ? undefined
          : {
              animationName: reducedMotion ? VALUE_FADE : VALUE_IN,
              animationDuration: VALUE_MS,
              animationTimingFunction: EASING,
            }
      }
    >
      {children}
    </Animated.View>
  );
}

export function UsageBar({
  className,
  style,
}: {
  className: string;
  style: Pick<ViewStyle, "height" | "width" | "opacity">;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <Animated.View
      className={className}
      style={[
        style,
        {
          transitionProperty: ["height", "width", "opacity"],
          transitionDuration: reducedMotion ? 0 : BAR_MS,
          transitionTimingFunction: EASING,
        },
      ]}
    />
  );
}

export function UsageLoading({ loading, children }: PropsWithChildren<{ loading: boolean }>) {
  return (
    <Animated.View
      style={{
        opacity: loading ? 0.55 : 1,
        transitionProperty: "opacity",
        transitionDuration: LOADING_MS,
        transitionTimingFunction: EASING,
      }}
    >
      {children}
    </Animated.View>
  );
}
