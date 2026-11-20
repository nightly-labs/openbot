import { Typography } from "heroui-native";
import { useEffect } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeroSlot } from "@/features/onboarding/components/onboarding-hero";
import { EASE_OUT_CSS, type OnboardingMotion, popEntering } from "@/features/onboarding/components/onboarding-motion";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const HERO_SIZE = 150;
const STAGE_SIZE = 260;
const BURST_DELAY_MS = 420;
const BURST_MS = 760;
const STAMP_DELAY_MS = 640;
const STAMP_MS = 380;
const STAMP_LANDS_AT = 0.6;
const STAMP = {
  from: { opacity: 0, transform: [{ scale: 1.6 }, { rotate: "-24deg" }] },
  "60%": { opacity: 1, transform: [{ scale: 0.94 }, { rotate: "-8deg" }] },
  to: { opacity: 1, transform: [{ scale: 1 }, { rotate: "-10deg" }] },
};
const FADE_IN = { from: { opacity: 0 }, to: { opacity: 1 } };

const SPARKS = Array.from({ length: 12 }, (_, index) => {
  const angle = (index / 12) * Math.PI * 2 + 0.2;
  const distance = index % 2 === 0 ? 118 : 92;
  const size = index % 3 === 0 ? 10 : 7;
  return {
    id: `spark-${index}`,
    size,
    square: index % 4 === 1,
    keyframes: {
      from: { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 0.4 }] },
      "25%": { opacity: 1 },
      to: {
        opacity: 0,
        transform: [
          { translateX: Math.cos(angle) * distance },
          { translateY: Math.sin(angle) * distance },
          { scale: 1 },
        ],
      },
    },
  };
});

export function ReadyStep({
  motion,
  color,
  roleTitle,
  name,
  withTask,
}: {
  motion: OnboardingMotion;
  color: string;
  roleTitle: string | null;
  name: string;
  withTask: boolean;
}) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const full = motion === "full";
  useEffect(() => {
    const landing = full ? STAMP_DELAY_MS + STAMP_MS * STAMP_LANDS_AT : 0;
    const timer = setTimeout(() => void haptics.notification("success"), landing);
    return () => clearTimeout(timer);
  }, [full]);

  return (
    <View className="flex-1 items-center justify-center gap-6 px-8" style={{ paddingTop: insets.top }}>
      <View className="items-center justify-center" style={{ width: STAGE_SIZE, height: STAGE_SIZE }}>
        {full
          ? SPARKS.map((spark, index) => (
              <Animated.View
                key={spark.id}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  width: spark.size,
                  height: spark.size,
                  borderRadius: spark.square ? 2 : spark.size / 2,
                  backgroundColor: index % 3 === 2 ? "#ffffff" : color,
                  opacity: 0,
                  animationName: spark.keyframes,
                  animationDuration: BURST_MS,
                  animationDelay: BURST_DELAY_MS + (index % 4) * 30,
                  animationFillMode: "both",
                  animationTimingFunction: EASE_OUT_CSS,
                }}
              />
            ))
          : null}
        <HeroSlot size={HERO_SIZE} />
        <Animated.View
          pointerEvents="none"
          className="absolute rounded-full px-3 py-1.5"
          style={{
            top: STAGE_SIZE / 2 - HERO_SIZE / 2 - 6,
            right: 4,
            borderWidth: 1.5,
            borderStyle: "dashed",
            borderColor: color,
            backgroundColor: `${color}26`,
            transform: [{ rotate: "-10deg" }],
            ...(motion === "none"
              ? null
              : {
                  animationName: full ? STAMP : FADE_IN,
                  animationDuration: full ? STAMP_MS : 200,
                  animationDelay: full ? STAMP_DELAY_MS : 0,
                  animationFillMode: "backwards" as const,
                  animationTimingFunction: EASE_OUT_CSS,
                }),
          }}
        >
          <Typography type="body-xs" className="font-semibold">
            {t("mobile.onboarding.ready.stamp")}
          </Typography>
        </Animated.View>
      </View>
      <Animated.View entering={popEntering(motion, full ? STAMP_DELAY_MS : 0)} className="items-center gap-2">
        <Typography.Heading type="h2" align="center" accessibilityRole="header" className="tracking-openbot-tight">
          {t("mobile.onboarding.ready.title", { name })}
        </Typography.Heading>
        {roleTitle ? (
          <Typography type="body-sm" className="font-medium text-text-secondary">
            {roleTitle}
          </Typography>
        ) : null}
        <Typography.Paragraph align="center" color="muted">
          {withTask ? t("mobile.onboarding.ready.bodyTask", { name }) : t("mobile.onboarding.ready.bodyRole", { name })}
        </Typography.Paragraph>
      </Animated.View>
    </View>
  );
}
