import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Sparkles from "lucide-react-native/icons/sparkles";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AccessibilityActionEvent, Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  ReduceMotion,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { HERO_LANDS_MS, HeroSlot } from "@/features/onboarding/components/onboarding-hero";
import {
  arriveEntering,
  EASE_OUT_CSS,
  handOffEntering,
  type OnboardingMotion,
  popEntering,
  slideSwapEntering,
  slideSwapExiting,
} from "@/features/onboarding/components/onboarding-motion";
import { STEP_TOP_GAP, StepHeader } from "@/features/onboarding/components/onboarding-parts";
import {
  CHOICE_COUNT,
  CHOICE_SWATCHES,
  CUSTOM_CHOICE,
  ONBOARDING_ROLES,
} from "@/features/onboarding/model/onboarding-roles";
import { useColumnWidth } from "@/shared/components/adaptive-split";
import { haptics } from "@/shared/lib/haptics";
import { SPLASH_EASE_OUT } from "@/shared/lib/splash-motion";
import { useText } from "@/shared/lib/text";
import { END_X } from "@/shared/lib/text-direction";
import { rubberBand } from "@/shared/lib/worklet-math";

const ITEM_WIDTH = 140;
const AVATAR_SIZE = 128;
const NEIGHBOUR_SCALE = 0.56;
const NEIGHBOUR_DROP = 26;
const GLOW_SIZE = 190;
const STAGE_HEIGHT = AVATAR_SIZE + 96;
const CUSTOM_SIZE = 84;
const MOMENTUM_SECONDS = 0.18;
const SNAP_SPRING = { duration: 400, dampingRatio: 0.8 };
const SETTLE_SPRING = { duration: 400, dampingRatio: 1 };
const SETTLE_MS = 450;
const RELAX_MS = 650;
const TEXT_FOLLOW_MS = 50;
const ARRIVE_FROM = 300;
const ARRIVE_STAGGER_MS = 70;
const STEP_ASIDE = 240;
const TEXT_DELAY_MS = 260;
const REDUCED_SNAP = { duration: 200, easing: SPLASH_EASE_OUT, reduceMotion: ReduceMotion.Never };

function StageItem({
  animated,
  index,
  choice,
  progress,
  focused,
  motion,
  arrivingFrom,
  leaving,
  onPress,
  children,
}: {
  index: number;
  choice: number;
  progress: SharedValue<number>;
  focused: boolean;
  motion: OnboardingMotion;
  arrivingFrom: 1 | -1;
  leaving: "forward" | "back" | null;
  onPress: () => void;
  animated: boolean;
  children: ReactNode;
}) {
  const offset = index - choice;
  const fromX = arrivingFrom === 1 ? ARRIVE_FROM : Math.sign(offset) * ARRIVE_FROM * 0.6;
  const arrival =
    arrivingFrom === -1 && offset === 0
      ? handOffEntering(motion, HERO_LANDS_MS)
      : arriveEntering(motion, fromX, 40 + Math.abs(offset) * ARRIVE_STAGGER_MS);
  const staying = leaving === "forward" && focused;
  const away = leaving === "back" ? 1 : offset < 0 ? -1 : 1;
  const full = motion === "full";
  const style = useAnimatedStyle(() => {
    const distance = Math.abs(progress.get() - index);
    const near = Math.min(1, distance);
    return {
      opacity: Math.max(0, 1 - near * 0.5 - Math.max(0, distance - 1) * 0.5),
      transform: [
        { translateY: full ? near * NEIGHBOUR_DROP : 0 },
        { scale: full ? 1 - near * (1 - NEIGHBOUR_SCALE) : 1 },
      ],
    };
  });
  return (
    <Animated.View entering={arrival}>
      <Animated.View
        style={{
          opacity: leaving && !staying ? 0 : 1,
          transform: [{ translateX: leaving && !staying ? away * END_X * STEP_ASIDE : 0 }],
          transitionProperty: ["opacity", "transform"],
          transitionDuration: motion === "none" ? 0 : 280,
          transitionTimingFunction: EASE_OUT_CSS,
        }}
      >
        <Animated.View
          style={[{ width: ITEM_WIDTH, alignItems: "center" }, style]}
          renderToHardwareTextureAndroid={!animated}
          shouldRasterizeIOS={!animated}
        >
          <Pressable onPress={onPress} disabled={focused} accessible={false} hitSlop={8}>
            {children}
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

function Glow({ color, visible, motion }: { color: string; visible: boolean; motion: OnboardingMotion }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: GLOW_SIZE,
        height: GLOW_SIZE,
        borderRadius: GLOW_SIZE / 2,
        backgroundColor: `${color}2e`,
        boxShadow: `0 0 72px 28px ${color}40`,
        opacity: visible ? 1 : 0,
        transitionProperty: "opacity",
        transitionDuration: motion === "none" ? 0 : 320,
        transitionTimingFunction: EASE_OUT_CSS,
      }}
    />
  );
}

function Dot({ index, progress }: { index: number; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const distance = Math.min(1, Math.abs(progress.get() - index));
    return { opacity: 1 - distance * 0.7, transform: [{ scale: 1.25 - distance * 0.25 }] };
  });
  return <Animated.View className="size-1.5 rounded-full bg-foreground" style={style} />;
}

export function AgentStep({
  motion,
  choice,
  progress,
  leaving,
  direction,
  onChoiceChange,
}: {
  motion: OnboardingMotion;
  choice: number;
  progress: SharedValue<number>;
  leaving: "forward" | "back" | null;
  direction: 1 | -1;
  onChoiceChange: (index: number) => void;
}) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const muted = String(useThemeColor("muted"));
  const stageWidth = useColumnWidth() - insets.left - insets.right;
  const side = (stageWidth - ITEM_WIDTH) / 2;
  const last = CHOICE_COUNT - 1;
  const full = motion === "full";

  const start = useSharedValue(0);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .failOffsetY([-14, 14])
        .onStart(() => {
          cancelAnimation(progress);
          start.set(progress.get());
        })
        .onUpdate((event) => {
          progress.set(rubberBand(start.get() - (event.translationX * END_X) / ITEM_WIDTH, last, 1 / 3));
        })
        .onEnd((event) => {
          const velocity = (-event.velocityX * END_X) / ITEM_WIDTH;
          const target = Math.max(0, Math.min(last, Math.round(progress.get() + velocity * MOMENTUM_SECONDS)));
          progress.set(
            full
              ? withSpring(target, { ...SNAP_SPRING, velocity, reduceMotion: ReduceMotion.Never })
              : withTiming(target, REDUCED_SNAP),
          );
        }),
    [full, last, progress, start],
  );
  const [settled, setSettled] = useState(choice);
  useEffect(() => {
    if (settled === choice) return;
    const timer = setTimeout(() => setSettled(choice), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [choice, settled]);
  const smiling = settled === choice ? settled : null;
  const [relaxing, setRelaxing] = useState<number | null>(null);
  const lastSmile = useRef<number | null>(smiling);
  const relaxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const previous = lastSmile.current;
    lastSmile.current = smiling;
    if (previous === null || previous === smiling) return;
    setRelaxing(previous);
    if (relaxTimer.current) clearTimeout(relaxTimer.current);
    relaxTimer.current = setTimeout(() => {
      relaxTimer.current = null;
      setRelaxing(null);
    }, RELAX_MS);
  }, [smiling]);
  useEffect(
    () => () => {
      if (relaxTimer.current) clearTimeout(relaxTimer.current);
    },
    [],
  );
  const live = (index: number) => full && (index === smiling || index === relaxing);
  const previousChoice = useRef(choice);
  const swipeDirection = useRef<1 | -1>(1);
  if (previousChoice.current !== choice) {
    swipeDirection.current = choice > previousChoice.current ? 1 : -1;
    previousChoice.current = choice;
  }
  const snap = useCallback(
    (index: number) => {
      void haptics.selection();
      onChoiceChange(index);
    },
    [onChoiceChange],
  );
  useAnimatedReaction(
    () => Math.max(0, Math.min(last, Math.round(progress.get()))),
    (index, previous) => {
      if (previous !== null && index !== previous) scheduleOnRN(snap, index);
    },
  );
  const moveTo = useCallback(
    (index: number) => {
      progress.set(
        full
          ? withSpring(index, { ...SETTLE_SPRING, reduceMotion: ReduceMotion.Never })
          : withTiming(index, REDUCED_SNAP),
      );
    },
    [full, progress],
  );
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -END_X * progress.get() * ITEM_WIDTH }] }));

  const role = choice === CUSTOM_CHOICE ? null : (ONBOARDING_ROLES[choice] ?? null);
  const title = role ? t(role.title) : t("mobile.onboarding.role.custom");
  const description = role ? t(role.description) : t("mobile.onboarding.role.customBody");

  function onAccessibilityAction(event: AccessibilityActionEvent) {
    const next = event.nativeEvent.actionName === "increment" ? choice + 1 : choice - 1;
    if (next < 0 || next > last) return;
    moveTo(next);
    onChoiceChange(next);
  }

  return (
    <GestureDetector gesture={pan}>
      <View className="flex-1" style={{ paddingTop: insets.top + STEP_TOP_GAP }}>
        <View className="px-6">
          <StepHeader
            title={t("mobile.onboarding.agent.title")}
            body={t("mobile.onboarding.agent.body")}
            motion={motion}
          />
        </View>
        <Animated.View
          className="flex-1 justify-center gap-5"
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t("mobile.onboarding.agent.pickerLabel")}
          accessibilityValue={{ text: `${title}. ${description}` }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={onAccessibilityAction}
        >
          <View
            className="items-center justify-center"
            style={{ height: STAGE_HEIGHT }}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            {CHOICE_SWATCHES.map((color, index) => (
              <Glow key={color} color={color} visible={index === choice} motion={motion} />
            ))}
            <View className="absolute">
              <HeroSlot size={AVATAR_SIZE} />
            </View>
            <View
              pointerEvents="none"
              className="absolute rounded-full bg-foreground"
              style={{ top: STAGE_HEIGHT / 2 + AVATAR_SIZE / 2 + 6, width: 76, height: 10, opacity: 0.1 }}
            />
            <Animated.View
              className="absolute flex-row items-center"
              style={[{ left: side, top: 0, height: STAGE_HEIGHT }, rowStyle]}
            >
              {ONBOARDING_ROLES.map((item, index) => (
                <StageItem
                  key={item.id}
                  animated={live(index)}
                  index={index}
                  choice={choice}
                  progress={progress}
                  focused={index === choice}
                  motion={motion}
                  arrivingFrom={direction}
                  leaving={leaving}
                  onPress={() => moveTo(index)}
                >
                  <BloubAvatarPreview
                    seed={item.avatarSeed}
                    hue={item.avatarHue}
                    size={AVATAR_SIZE}
                    mood={index === smiling ? "responded" : "idle"}
                    animateIdle={live(index)}
                  />
                </StageItem>
              ))}
              <StageItem
                animated={false}
                index={CUSTOM_CHOICE}
                choice={choice}
                progress={progress}
                focused={choice === CUSTOM_CHOICE}
                motion={motion}
                arrivingFrom={direction}
                leaving={leaving}
                onPress={() => moveTo(CUSTOM_CHOICE)}
              >
                <View className="items-center justify-center" style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}>
                  <View
                    className="items-center justify-center rounded-full"
                    style={{
                      width: CUSTOM_SIZE,
                      height: CUSTOM_SIZE,
                      borderWidth: 2,
                      borderStyle: "dashed",
                      borderColor: muted,
                    }}
                  >
                    <Sparkles size={28} color={muted} strokeWidth={1.75} />
                  </View>
                </View>
              </StageItem>
            </Animated.View>
          </View>
          <Animated.View
            entering={popEntering(motion, TEXT_DELAY_MS)}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            <Animated.View
              className="items-center gap-2 px-8"
              style={{
                opacity: leaving ? 0 : 1,
                transitionProperty: "opacity",
                transitionDuration: motion === "none" ? 0 : 200,
                transitionTimingFunction: EASE_OUT_CSS,
              }}
            >
              <View className="min-h-10 w-full">
                <Animated.View
                  key={choice}
                  entering={slideSwapEntering(motion, swipeDirection.current)}
                  exiting={slideSwapExiting(motion)}
                  className="absolute inset-x-0 top-0"
                >
                  <Typography.Heading type="h2" align="center" numberOfLines={1} className="tracking-openbot-tight">
                    {title}
                  </Typography.Heading>
                </Animated.View>
              </View>
              <View className="min-h-16 w-full">
                <Animated.View
                  key={choice}
                  entering={slideSwapEntering(motion, swipeDirection.current, TEXT_FOLLOW_MS)}
                  exiting={slideSwapExiting(motion)}
                  className="absolute inset-x-0 top-0"
                >
                  <Typography.Paragraph align="center" color="muted">
                    {description}
                  </Typography.Paragraph>
                </Animated.View>
              </View>
              <View className="flex-row justify-center gap-2 pt-2" pointerEvents="none">
                {CHOICE_SWATCHES.map((color, index) => (
                  <Dot key={color} index={index} progress={progress} />
                ))}
              </View>
            </Animated.View>
          </Animated.View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
