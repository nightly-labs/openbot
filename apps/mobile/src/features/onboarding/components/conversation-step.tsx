import { Separator, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { type ReactNode, useEffect, useRef } from "react";
import { Keyboard, Platform, ScrollView, type ScrollViewInstance, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SpeechBubble, TYPING_MS } from "@/features/onboarding/components/onboarding-bubble";
import { GlassChoice } from "@/features/onboarding/components/onboarding-glass";
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
import { fieldDirectionStyle } from "@/shared/lib/text-direction";

const HEADER_HERO_SIZE = 56;
const REPLIES_AT = STAGGER_MS + TYPING_MS;

function replyGlassDelay(index: number): number {
  return glassAfter(REPLIES_AT + (index + 1) * STAGGER_MS);
}

export function ConversationStep({
  motion,
  name,
  caption,
  question,
  ideas,
  value,
  onChange,
  label,
  placeholder,
  maxLength,
  color,
  disabled,
  action,
  children,
}: {
  motion: OnboardingMotion;
  name: string;
  caption: string | null;
  question: string;
  ideas: readonly string[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  maxLength?: number;
  color: string;
  disabled: boolean;
  action?: { label: string; onPress: () => void };
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const scroller = useRef<ScrollViewInstance>(null);
  const composing = useRef(false);
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  const reply = (index: number, label: string, selected: boolean, onPress: () => void) => (
    <View key={label} className="max-w-[86%]">
      <GlassChoice
        appearDelay={replyGlassDelay(index)}
        label={label}
        selected={selected}
        disabled={disabled}
        color={color}
        radius={22}
        onPress={onPress}
      >
        <Typography type="body-sm" className="px-4 py-3 font-medium">
          {label}
        </Typography>
      </GlassChoice>
    </View>
  );
  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidShow", () =>
      scroller.current?.scrollToEnd({ animated: true }),
    );
    return () => subscription.remove();
  }, []);
  return (
    <View className="flex-1" style={{ paddingTop: insets.top + STEP_TOP_GAP }}>
      <View className="flex-row items-center gap-3 px-6">
        <HeroSlot size={HEADER_HERO_SIZE} />
        <Animated.View entering={popEntering(motion, STAGGER_MS)} className="min-w-0 flex-1">
          <Typography.Heading type="h4" numberOfLines={1}>
            {name}
          </Typography.Heading>
          {caption ? (
            <Typography type="body-sm" numberOfLines={1} className="text-text-secondary">
              {caption}
            </Typography>
          ) : null}
        </Animated.View>
      </View>
      <ScrollView
        ref={scroller}
        onLayout={() => {
          if (composing.current) scroller.current?.scrollToEnd({ animated: false });
        }}
        onContentSizeChange={() => {
          if (composing.current) scroller.current?.scrollToEnd({ animated: true });
        }}
        className="flex-1"
        contentContainerClassName="grow gap-4 px-6 pt-4 pb-4"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        alwaysBounceVertical={false}
        showsVerticalScrollIndicator={false}
      >
        <SpeechBubble motion={motion} tail="top" delay={STAGGER_MS} text={question} color={color} />
        <View className="items-end gap-2">
          {ideas.map((idea, index) => {
            const chosen = value === idea;
            return reply(index, idea, chosen, () => {
              void haptics.selection();
              onChange(chosen ? "" : idea);
            });
          })}
          {action ? (
            <>
              <Animated.View
                entering={popEntering(motion, replyGlassDelay(ideas.length))}
                className="my-1 w-16"
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden
              >
                <Separator />
              </Animated.View>
              {reply(ideas.length, action.label, false, action.onPress)}
            </>
          ) : null}
        </View>
        {children}
      </ScrollView>
      <View className="px-6 pb-1">
        <TextInput
          multiline
          editable={!disabled}
          value={value}
          onChangeText={onChange}
          onFocus={() => {
            composing.current = true;
          }}
          onBlur={() => {
            composing.current = false;
          }}
          accessibilityLabel={label}
          placeholder={placeholder}
          placeholderTextColor={String(muted)}
          maxLength={maxLength}
          {...selectionColorProps(color)}
          textAlignVertical="top"
          className="font-sans text-[17px]"
          style={{ color: String(foreground), maxHeight: 132, paddingVertical: 12, ...fieldDirectionStyle(value) }}
        />
      </View>
    </View>
  );
}
