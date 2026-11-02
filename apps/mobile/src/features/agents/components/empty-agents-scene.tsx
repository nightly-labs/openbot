import { Typography } from "heroui-native";
import { useEffect, useState } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import Animated, { cubicBezier, Easing, FadeOut, ReduceMotion } from "react-native-reanimated";
import { AgentCrowd, CROWD_SHARE, TEXT_SHARE } from "@/features/agents/components/agent-crowd";
import { OnboardingPrimaryButton } from "@/features/onboarding/components/onboarding-buttons";
import { useColumnWidth } from "@/shared/components/adaptive-split";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";

// CSS animations take `cubicBezier`; layout animations take a worklet `Easing` function.
const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
const EXIT = FadeOut.duration(160)
  .easing(Easing.bezier(0.23, 1, 0.32, 1))
  .reduceMotion(ReduceMotion.Never);
const RISE_IN = {
  from: { opacity: 0, transform: [{ translateY: 12 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }] },
};
// Reduce Motion keeps the fade and drops the movement.
const FADE_IN = { from: { opacity: 0 }, to: { opacity: 1 } };
const RISE_MS = 320;
// The main action has this inset at each side, as in the welcome's footer.
const ACTION_INSET = 20;
const ACTION_SETTLE_MS = 360;
// After the welcome, the home's text and action change when the welcome has as good as faded, so
// the two texts never show over each other.
const AFTER_WELCOME_MS = 200;

/** The welcome's main action when the user skipped the welcome: its label, and its place across the window. */
export interface WelcomeHandOff {
  label: string;
  x: number;
  width: number;
}

/**
 * The home screen of a server with no agents, in the layout of the welcome: its group of
 * characters, the text under it, and one main action at the bottom, under the thumb. `style` sets
 * the insets when the scene fills the screen in place of the list. `afterWelcome`: the user skipped
 * the welcome, which fades off the same group in the same places. The group is there at once, the
 * text changes in place, and the action starts as the welcome's main action and turns into this one.
 */
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
  // Only the first render counts: the scene can show again later, with its usual entrance.
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
      {/* The text sits in the middle of the space between the group and the main action. */}
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
      {/* The main action of the welcome: a glass button on iOS, a Material one on Android, in the
          neutral action colour, because the characters carry the colour of the scene. After the
          welcome, it widens from the place of the welcome's action, and its label changes. */}
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
