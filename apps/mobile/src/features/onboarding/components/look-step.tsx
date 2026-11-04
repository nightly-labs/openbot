import { AVATAR_COLOR_CHOICES, type AvatarColorChoice, isAvatarColorChoice } from "@openbot/brand/bloub-avatar";
import type { AvatarColor, AvatarHue } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Dices from "lucide-react-native/icons/dices";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { ReduceMotion, type SharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { type AgentColorValue, avatarColorChoiceLabel } from "@/features/agents/components/agent-appearance-picker";
import { createAvatarCandidates } from "@/features/agents/model/avatar-candidates";
import { OnboardingIconButton, OnboardingPillButton } from "@/features/onboarding/components/onboarding-buttons";
import { HeroSlot } from "@/features/onboarding/components/onboarding-hero";
import {
  EASE_OUT_CSS,
  glassAfter,
  type OnboardingMotion,
  popEntering,
  STAGGER_MS,
} from "@/features/onboarding/components/onboarding-motion";
import { STEP_TOP_GAP, StepHeader } from "@/features/onboarding/components/onboarding-parts";
import { haptics } from "@/shared/lib/haptics";
import { SPLASH_EASE_OUT } from "@/shared/lib/splash-motion";
import { useText } from "@/shared/lib/text";

// A swipe changes the look when it goes this far, or this fast.
const SWIPE_DISTANCE = 70;
const SWIPE_VELOCITY = 600;
const THROW = { duration: 170, easing: SPLASH_EASE_OUT, reduceMotion: ReduceMotion.Never };
const SETTLE = { duration: 400, dampingRatio: 0.8, reduceMotion: ReduceMotion.Never };
// The next look comes in from this share of the screen, on the other side.
const ENTER_FROM = 0.6;
// Nine colours fit one row on a 375 pt wide phone.
const SWATCH_SIZE = 28;
// The colours show in two rows of nine; the automatic colour ends the second row.
const COLOR_ROWS: readonly (readonly AvatarColorChoice[])[] = [
  AVATAR_COLOR_CHOICES.slice(0, 9),
  AVATAR_COLOR_CHOICES.slice(9),
];
const ARROW_SIZE = 44;

/**
 * The look of an agent made from scratch. The character itself is the control: drag it aside and
 * it flies off, and the next look comes in from the other side. Arrows do the same with a tap, and
 * Surprise me draws new looks. The colours sit in two rows below.
 */
export function LookStep({
  motion,
  seed,
  hue,
  color,
  drag,
  onSeedChange,
  onColorChange,
  onPulse,
}: {
  motion: OnboardingMotion;
  seed: string;
  hue: AvatarHue | null;
  /** The agent's `avatarColor`. It wins over `hue`. */
  color: AvatarColor | null;
  /** The hero's swipe offset, shared with the hero above the steps. */
  drag: SharedValue<number>;
  onSeedChange: (seed: string) => void;
  onColorChange: (value: AgentColorValue) => void;
  /** Plays the hero's squash, when a new look appears in place. */
  onPulse: () => void;
}) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const foreground = useThemeColor("foreground");
  const [candidates, setCandidates] = useState(() => createAvatarCandidates(seed));
  const full = motion === "full";
  const heroSize = height < 760 ? 128 : 168;

  /** Shows the next look (1) or the previous one (-1). With motion, it comes in from that side. */
  const advance = useCallback(
    (direction: 1 | -1) => {
      const seeds = candidates.seeds;
      const index = Math.max(0, seeds.indexOf(seed));
      const next = seeds[(index + direction + seeds.length) % seeds.length];
      if (next) onSeedChange(next);
      void haptics.selection();
      if (!full) {
        onPulse();
        return;
      }
      // The new look renders first, then flies in, so the old one never comes back.
      requestAnimationFrame(() => {
        drag.set(direction * width * ENTER_FROM);
        drag.set(withSpring(0, SETTLE));
      });
    },
    [candidates.seeds, drag, full, onPulse, onSeedChange, seed, width],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .failOffsetY([-14, 14])
        .onUpdate((event) => {
          drag.set(event.translationX);
        })
        .onEnd((event) => {
          const flick = Math.abs(event.velocityX) > SWIPE_VELOCITY;
          if (!flick && Math.abs(event.translationX) < SWIPE_DISTANCE) {
            drag.set(withSpring(0, { ...SETTLE, velocity: event.velocityX }));
            return;
          }
          // It leaves on the side it is thrown to; the next look comes from the other side.
          const side = (flick ? event.velocityX : event.translationX) < 0 ? -1 : 1;
          const direction = side < 0 ? 1 : -1;
          if (!full) {
            drag.set(0);
            scheduleOnRN(advance, direction);
            return;
          }
          drag.set(
            withTiming(side * width, THROW, (finished) => {
              if (finished) scheduleOnRN(advance, direction);
            }),
          );
        }),
    [advance, drag, full, width],
  );

  const shuffle = () => {
    const next = createAvatarCandidates(seed, candidates);
    setCandidates(next);
    const pick = next.seeds[1] ?? next.seeds[0];
    if (pick) onSeedChange(pick);
    void haptics.impact("light");
    onPulse();
  };

  return (
    <GestureDetector gesture={pan}>
      <View className="flex-1" style={{ paddingTop: insets.top + STEP_TOP_GAP }}>
        <View className="px-6">
          <StepHeader
            title={t("mobile.onboarding.custom.title")}
            body={t("mobile.onboarding.custom.body")}
            motion={motion}
          />
        </View>
        <View className="flex-1 flex-row items-center justify-between px-3">
          <OnboardingIconButton
            appearDelay={glassAfter(0)}
            icon={ChevronLeft}
            label={t("mobile.onboarding.custom.previousLook")}
            size={ARROW_SIZE}
            onPress={() => advance(-1)}
          />
          <HeroSlot size={heroSize} />
          <OnboardingIconButton
            appearDelay={glassAfter(0)}
            icon={ChevronRight}
            label={t("mobile.onboarding.custom.nextLook")}
            size={ARROW_SIZE}
            onPress={() => advance(1)}
          />
        </View>
        <View className="items-center pb-6">
          <OnboardingPillButton
            label={t("mobile.onboarding.custom.shuffle")}
            icon={Dices}
            appearDelay={glassAfter(STAGGER_MS * 3)}
            onPress={shuffle}
          />
        </View>
        <Animated.View entering={popEntering(motion, STAGGER_MS * 3)} className="items-center gap-6 px-6 pb-3">
          <View
            className="w-full gap-3"
            accessibilityRole="radiogroup"
            accessibilityLabel={t("mobile.agent.appearance.color")}
          >
            {COLOR_ROWS.map((row, index) => (
              <View key={row[0]?.swatch ?? index} className="w-full flex-row items-center justify-between">
                {row.map((choice) => (
                  <Swatch
                    key={choice.swatch}
                    label={t(avatarColorChoiceLabel(choice))}
                    checked={isAvatarColorChoice(choice, hue, color)}
                    ring={String(foreground)}
                    motion={motion}
                    onPress={() => {
                      void haptics.selection();
                      onColorChange({ hue: choice.hue, color: choice.color });
                    }}
                  >
                    <View className="size-full rounded-full" style={{ backgroundColor: choice.swatch }} />
                  </Swatch>
                ))}
                {index === COLOR_ROWS.length - 1 ? (
                  <Swatch
                    label={t("mobile.agent.appearance.automatic")}
                    checked={hue === null && color === null}
                    ring={String(foreground)}
                    motion={motion}
                    onPress={() => {
                      void haptics.selection();
                      onColorChange({ hue: null, color: null });
                    }}
                  >
                    <View className="size-full items-center justify-center rounded-full bg-grouped">
                      <Typography type="body-xs" className="font-semibold">
                        {t("mobile.agent.appearance.automaticShort")}
                      </Typography>
                    </View>
                  </Swatch>
                ) : null}
              </View>
            ))}
          </View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

/** One colour. The chosen one grows a little and gets a ring. */
function Swatch({
  label,
  checked,
  ring,
  motion,
  onPress,
  children,
}: {
  label: string;
  checked: boolean;
  ring: string;
  motion: OnboardingMotion;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      hitSlop={6}
      onPress={onPress}
    >
      <Animated.View
        className="items-center justify-center rounded-full"
        style={{
          width: SWATCH_SIZE + 8,
          height: SWATCH_SIZE + 8,
          borderWidth: 2,
          borderColor: checked ? ring : "transparent",
          transform: [{ scale: checked ? 1.08 : 1 }],
          transitionProperty: ["transform", "borderColor"],
          transitionDuration: motion === "none" ? 0 : 160,
          transitionTimingFunction: EASE_OUT_CSS,
        }}
      >
        <View style={{ width: SWATCH_SIZE, height: SWATCH_SIZE }}>{children}</View>
      </Animated.View>
    </Pressable>
  );
}
