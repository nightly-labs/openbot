import { Typography } from "heroui-native";
import { useEffect, useState } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import Animated, { cubicBezier, Easing, FadeOut, ReduceMotion } from "react-native-reanimated";
import { AgentCrowd, CROWD_SHARE, TEXT_SHARE } from "@/features/agents/components/agent-crowd";
import { OnboardingPrimaryButton } from "@/features/onboarding/components/onboarding-buttons";
import { useColumnWidth } from "@/shared/components/adaptive-split";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";

const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
const EXIT = FadeOut.duration(160)
  .easing(Easing.bezier(0.23, 1, 0.32, 1))
  .reduceMotion(ReduceMotion.Never);
const RISE_IN = {
  from: { opacity: 0, transform: [{ translateY: 12 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }] },
};
const FADE_IN = { from: { opacity: 0 }, to: { opacity: 1 } };
const RISE_MS = 320;
const ACTION_INSET = 20;
const ACTION_SETTLE_MS = 360;
const AFTER_WELCOME_MS = 200;

export interface WelcomeHandOff {
  label: string;
  x: number;
  width: number;
}

export function EmptyAgentsScene({
  onAddAgent,
  style,
  afterWelcome = null,
}: {
  onAddAgent: () => void;
  style?: StyleProp<ViewStyle>;
  afterWelcome?: WelcomeHandOff | null;
}) {
  const { t } = useText();
  const reducedMotion = useReducedMotion();
  const windowWidth = useColumnWidth();
  const [welcome] = useState(afterWelcome);
  const [settled, setSettled] = useState(welcome === null);
  useEffect(() => {
    if (settled) return;
    const timer = setTimeout(() => setSettled(true), AFTER_WELCOME_MS);
    return () => clearTimeout(timer);
  }, [settled]);
  const rise = welcome
    ? ({
        animationName: reducedMotion ? FADE_IN : RISE_IN,
        animationDuration: RISE_MS,
        animationDelay: AFTER_WELCOME_MS,
        animationFillMode: "backwards",
        animationTimingFunction: EASE_OUT,
      } as const)
    : null;
  return (
    <Animated.View className="flex-1" style={style} exiting={EXIT}>
      <View style={{ flex: CROWD_SHARE }}>
        <AgentCrowd motion={reducedMotion ? "fade" : "full"} instant={welcome !== null} />
      </View>
      <Animated.View className="items-center justify-center px-8" style={[{ flex: TEXT_SHARE }, rise]}>
        <View className="items-center gap-3">
          <Typography.Heading type="h2" align="center" accessibilityRole="header" className="tracking-openbot-tight">
            {t("mobile.agent.home.noAgents")}
          </Typography.Heading>
          <Typography.Paragraph align="center" color="muted">
            {t("mobile.agent.home.noAgentsBody")}
          </Typography.Paragraph>
        </View>
      </Animated.View>
      <Animated.View
        className="pt-3"
        style={{
          paddingLeft: settled || !welcome ? ACTION_INSET : welcome.x,
          paddingRight: settled || !welcome ? ACTION_INSET : windowWidth - welcome.x - welcome.width,
          transitionProperty: ["paddingLeft", "paddingRight"],
          transitionDuration: reducedMotion ? 0 : ACTION_SETTLE_MS,
          transitionTimingFunction: EASE_OUT,
        }}
      >
        <OnboardingPrimaryButton
          label={settled || !welcome ? t("mobile.agent.home.addAgent") : welcome.label}
          onPress={onAddAgent}
        />
      </Animated.View>
    </Animated.View>
  );
}
