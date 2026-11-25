import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, { LinearTransition, ReduceMotion } from "react-native-reanimated";

import {
  EASE_OUT_CSS,
  type OnboardingMotion,
  popEntering,
  swapEntering,
  swapExiting,
} from "@/features/onboarding/components/onboarding-motion";
import { readableOn } from "@/features/onboarding/model/onboarding-colors";
import { SPLASH_EASE_OUT } from "@/shared/lib/splash-motion";

export const TYPING_MS = 700;
const DOT = {
  from: { opacity: 0.35, transform: [{ translateY: 0 }] },
  to: { opacity: 1, transform: [{ translateY: -3 }] },
};
const RESIZE = LinearTransition.duration(180).easing(SPLASH_EASE_OUT).reduceMotion(ReduceMotion.System);

function TypingDots({ color }: { color: string | undefined }) {
  const muted = String(useThemeColor("muted"));
  return (
    <View className="h-7 flex-row items-center gap-1.5 px-1">
      {[0, 1, 2].map((index) => (
        <Animated.View
          key={index}
          className="size-2 rounded-full"
          style={{
            backgroundColor: color ?? muted,
            animationName: DOT,
            animationDuration: 360,
            animationDelay: index * 120,
            animationDirection: "alternate",
            animationIterationCount: "infinite",
            animationTimingFunction: EASE_OUT_CSS,
          }}
        />
      ))}
    </View>
  );
}

export function SpeechBubble({
  text,
  textKey = text,
  motion,
  tail,
  delay = 0,
  color,
}: {
  text: string;
  textKey?: string;
  motion: OnboardingMotion;
  tail: "bottom" | "top";
  delay?: number;
  color?: string;
}) {
  const typing = motion === "full";
  const ink = color ? readableOn(color) : undefined;
  const fill = color ? { backgroundColor: color } : null;
  const [spoken, setSpoken] = useState(!typing);
  useEffect(() => {
    if (spoken) return;
    const timer = setTimeout(() => setSpoken(true), delay + TYPING_MS);
    return () => clearTimeout(timer);
  }, [delay, spoken]);

  return (
    <Animated.View
      entering={popEntering(motion, delay)}
      layout={motion === "none" ? undefined : RESIZE}
      className={tail === "bottom" ? "items-center self-center" : "items-start self-start"}
    >
      {tail === "top" ? <Tail placement="top" color={color} /> : null}
      <View
        className={color ? "max-w-80 rounded-[22px] px-4 py-3" : "max-w-80 rounded-[22px] bg-grouped px-4 py-3"}
        style={[{ borderCurve: "continuous" }, fill]}
        accessibilityLiveRegion="polite"
      >
        {spoken ? (
          <Animated.View key={textKey} entering={swapEntering(motion)} exiting={swapExiting(motion)}>
            <Typography.Heading
              type="h4"
              accessibilityRole="header"
              align={tail === "bottom" ? "center" : "start"}
              className="tracking-openbot-tight"
              style={ink ? { color: ink } : undefined}
            >
              {text}
            </Typography.Heading>
          </Animated.View>
        ) : (
          <TypingDots color={ink} />
        )}
      </View>
      {tail === "bottom" ? <Tail placement="bottom" color={color} /> : null}
    </Animated.View>
  );
}

function Tail({ placement, color }: { placement: "top" | "bottom"; color: string | undefined }) {
  return (
    <View
      className={color ? "size-3.5" : "size-3.5 bg-grouped"}
      style={{
        ...(color ? { backgroundColor: color } : null),
        transform: [{ rotate: "45deg" }],
        marginTop: placement === "bottom" ? -8 : 0,
        marginBottom: placement === "top" ? -8 : 0,
        marginLeft: placement === "top" ? 20 : 0,
        borderRadius: 3,
      }}
    />
  );
}
