import { Typography } from "heroui-native";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import type { ReactNode, RefObject } from "react";
import { ScrollView, View, type ViewInstance } from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  OnboardingIconButton,
  OnboardingPillButton,
  OnboardingPrimaryButton,
} from "@/features/onboarding/components/onboarding-buttons";
import {
  growEntering,
  type OnboardingMotion,
  popEntering,
  STAGGER_MS,
} from "@/features/onboarding/components/onboarding-motion";
import { useText } from "@/shared/lib/text";

export const STEP_TOP_GAP = 24;
const CONTROL_SIZE = 52;

export function StepScroll({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="grow gap-6 px-6 pb-6"
      contentContainerStyle={{ paddingTop: insets.top + STEP_TOP_GAP }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      alwaysBounceVertical={false}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

export function StepHeader({ title, body, motion }: { title: string; body?: string; motion: OnboardingMotion }) {
  return (
    <View className="gap-2">
      <Animated.View entering={popEntering(motion, STAGGER_MS)}>
        <Typography.Heading type="h2" accessibilityRole="header" className="tracking-openbot-tight">
          {title}
        </Typography.Heading>
      </Animated.View>
      {body ? (
        <Animated.View entering={popEntering(motion, STAGGER_MS * 2)}>
          <Typography.Paragraph color="muted">{body}</Typography.Paragraph>
        </Animated.View>
      ) : null}
    </View>
  );
}

function Slot({
  width,
  visible,
  motion,
  children,
}: {
  width?: number;
  visible: boolean;
  motion: OnboardingMotion;
  children: ReactNode;
}) {
  return (
    <View style={width === undefined ? { minWidth: CONTROL_SIZE } : { width }} className="items-center justify-center">
      {visible ? <Animated.View entering={growEntering(motion)}>{children}</Animated.View> : null}
    </View>
  );
}

export interface FooterAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
}

export function OnboardingFooter({
  motion,
  primary,
  onBack,
  onSkip,
  busy,
  primaryRef,
}: {
  motion: OnboardingMotion;
  primary: FooterAction | null;
  primaryRef?: RefObject<ViewInstance | null>;
  onBack: (() => void) | null;
  onSkip: (() => void) | null;
  busy: boolean;
}) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const { progress } = useReanimatedKeyboardAnimation();
  const keyboardStyle = useAnimatedStyle(() => ({ transform: [{ translateY: insets.bottom * progress.get() }] }));
  return (
    <Animated.View
      className="flex-row items-center gap-3 px-5 pt-3"
      style={[{ paddingBottom: insets.bottom + 12 }, keyboardStyle]}
    >
      <Slot width={CONTROL_SIZE} visible={onBack !== null} motion={motion}>
        <OnboardingIconButton
          icon={ChevronLeft}
          label={t("mobile.onboarding.back")}
          size={CONTROL_SIZE}
          disabled={busy}
          onPress={() => onBack?.()}
        />
      </Slot>
      <View ref={primaryRef} collapsable={false} className="flex-1" style={{ height: CONTROL_SIZE }}>
        {primary ? (
          <OnboardingPrimaryButton
            label={primary.label}
            color={primary.color}
            disabled={primary.disabled === true}
            onPress={() => primary.onPress()}
          />
        ) : null}
      </View>
      <Slot visible={onSkip !== null} motion={motion}>
        <OnboardingPillButton
          label={t("mobile.onboarding.skip")}
          size="large"
          disabled={busy}
          onPress={() => onSkip?.()}
        />
      </Slot>
    </Animated.View>
  );
}
