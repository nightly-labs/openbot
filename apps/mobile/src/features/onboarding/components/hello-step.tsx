import { Typography } from "heroui-native";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AgentCrowd, CROWD_SHARE, CROWD_TOP, TEXT_SHARE } from "@/features/agents/components/agent-crowd";
import {
  EASE_OUT_CSS,
  type OnboardingMotion,
  popEntering,
  STAGGER_MS,
} from "@/features/onboarding/components/onboarding-motion";
import { useText } from "@/shared/lib/text";

export function HelloStep({ motion, leaving }: { motion: OnboardingMotion; leaving: boolean }) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const fade = {
    opacity: leaving ? 0 : 1,
    transitionProperty: "opacity" as const,
    transitionDuration: 200,
    transitionTimingFunction: EASE_OUT_CSS,
  };
  return (
    <View className="flex-1" style={{ paddingTop: insets.top + CROWD_TOP }}>
      <View style={{ flex: CROWD_SHARE }}>
        <AgentCrowd motion={motion} leaving={leaving} />
      </View>
      <Animated.View className="items-center justify-center px-8" style={[{ flex: TEXT_SHARE }, fade]}>
        <Animated.View entering={popEntering(motion, STAGGER_MS * 4)} className="items-center gap-3">
          <Typography.Heading type="h2" align="center" accessibilityRole="header" className="tracking-openbot-tight">
            {t("mobile.onboarding.hello.title")}
          </Typography.Heading>
          <Typography.Paragraph align="center" color="muted">
            {t("mobile.onboarding.hello.body")}
          </Typography.Paragraph>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
