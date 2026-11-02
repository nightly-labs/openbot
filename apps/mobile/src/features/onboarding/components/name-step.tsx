import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { useThemeColor } from "heroui-native/hooks";
import { useEffect, useRef } from "react";
import { TextInput, type TextInputInstance, useWindowDimensions, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SpeechBubble } from "@/features/onboarding/components/onboarding-bubble";
import { OnboardingPillButton } from "@/features/onboarding/components/onboarding-buttons";
import { HeroSlot } from "@/features/onboarding/components/onboarding-hero";
import {
  glassAfter,
  type OnboardingMotion,
  popEntering,
  STAGGER_MS,
} from "@/features/onboarding/components/onboarding-motion";
import { STEP_TOP_GAP } from "@/features/onboarding/components/onboarding-parts";
import { haptics } from "@/shared/lib/haptics";
import { selectionColorProps } from "@/shared/lib/selection-color";
import { useText } from "@/shared/lib/text";

const NAME_IDEAS = [
  "mobile.onboarding.name.idea1",
  "mobile.onboarding.name.idea2",
  "mobile.onboarding.name.idea3",
  "mobile.onboarding.name.idea4",
] as const;
// The ideas come in right after the step, quickly one after another.
const NAME_IDEA_STAGGER_MS = 40;
// The keyboard opens when the step has stopped moving.
const FOCUS_DELAY_MS = 380;

/**
 * The agent asks for its name and says it back while the user types it. The name is large, centred
 * text with no box around it; the cursor wears the agent's colour.
 */
export function NameStep({
  motion,
  color,
  name,
  onNameChange,
  onContinue,
}: {
  motion: OnboardingMotion;
  /** The colour of the agent. */
  color: string;
  name: string;
  onNameChange: (name: string) => void;
  /** The return key goes on, as the main action does. */
  onContinue: () => void;
}) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  const input = useRef<TextInputInstance>(null);
  const trimmed = name.trim();
  // Small phones keep the field and the ideas above the keyboard.
  const heroSize = height < 760 ? 100 : 132;

  useEffect(() => {
    const timer = setTimeout(() => input.current?.focus(), FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View className="flex-1 items-center px-6" style={{ paddingTop: insets.top + STEP_TOP_GAP }}>
      <View className="min-h-24 w-full items-center justify-end">
        <SpeechBubble
          motion={motion}
          color={color}
          tail="bottom"
          delay={STAGGER_MS * 2}
          text={
            trimmed ? t("mobile.onboarding.name.greeting", { name: trimmed }) : t("mobile.onboarding.name.question")
          }
          textKey={trimmed ? "greeting" : "question"}
        />
      </View>
      <View className="mt-3">
        <HeroSlot size={heroSize} />
      </View>
      <Animated.View entering={popEntering(motion, STAGGER_MS * 3)} className="mt-7 w-full max-w-80">
        <TextInput
          ref={input}
          value={name}
          onChangeText={onNameChange}
          onSubmitEditing={() => {
            if (trimmed) onContinue();
          }}
          accessibilityLabel={t("mobile.onboarding.name.label")}
          placeholder={t("mobile.onboarding.name.placeholder")}
          placeholderTextColor={String(muted)}
          maxLength={INPUT_LIMITS.agentName}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
          submitBehavior="submit"
          {...selectionColorProps(color)}
          textAlign="center"
          className="w-full font-sans font-semibold text-[30px]"
          style={{ color: String(foreground), paddingVertical: 8 }}
        />
      </Animated.View>
      <View className="mt-5 flex-row flex-wrap justify-center gap-2">
        {NAME_IDEAS.map((key, index) => {
          const idea = t(key);
          return (
            <View key={key}>
              <OnboardingPillButton
                appearDelay={glassAfter(0) + index * NAME_IDEA_STAGGER_MS}
                label={idea}
                selected={trimmed === idea}
                color={color}
                onPress={() => {
                  void haptics.selection();
                  onNameChange(idea);
                }}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}
