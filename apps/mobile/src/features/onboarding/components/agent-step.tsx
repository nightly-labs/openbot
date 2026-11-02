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

// The characters stand on a stage: one in the middle at full size, a neighbour on each side,
// smaller, lower and dimmer, as on a character select screen.
const ITEM_WIDTH = 140;
const AVATAR_SIZE = 128;
const NEIGHBOUR_SCALE = 0.56;
const NEIGHBOUR_DROP = 26;
const GLOW_SIZE = 190;
const STAGE_HEIGHT = AVATAR_SIZE + 96;
// A character's body fills about two thirds of its frame. The empty choice matches the body.
const CUSTOM_SIZE = 84;
// How far a flick carries: its speed times this many seconds, in choices.
const MOMENTUM_SECONDS = 0.18;
// The snap after a drag keeps the finger's speed; a tap settles without overshoot.
const SNAP_SPRING = { duration: 400, dampingRatio: 0.8 };
const SETTLE_SPRING = { duration: 400, dampingRatio: 1 };
// The character in the middle smiles when the stage has rested this long.
const SETTLE_MS = 450;
// A face takes this long to relax from its smile; the character draws live until it is done.
const RELAX_MS = 650;
// The description follows the name by one beat.
const TEXT_FOLLOW_MS = 50;
// Characters fly onto the stage: the middle one first, then each neighbour after it.
const ARRIVE_FROM = 300;
const ARRIVE_STAGGER_MS = 70;
// On the way out, the neighbours step this far aside and fade.
const STEP_ASIDE = 240;
// The text under the stage follows the characters.
const TEXT_DELAY_MS = 260;
// Reduce Motion: the stage still follows the finger, then settles quickly with no spring.
const REDUCED_SNAP = { duration: 200, easing: SPLASH_EASE_OUT, reduceMotion: ReduceMotion.Never };

/** Resistance past the first and the last choice: the stage moves a third as far as the finger. */
function rubberBand(value: number, max: number): number {
  "worklet";
  if (value < 0) return value / 3;
  if (value > max) return max + (value - max) / 3;
  return value;
}

/** One character on the stage. It shrinks, sinks and fades with its distance from the middle. */
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
  /** The choice in the middle. */
  choice: number;
  /** The scroll position in characters: 0 at the first one, 1 at the second. */
  progress: SharedValue<number>;
  focused: boolean;
  motion: OnboardingMotion;
  /** The direction the step came from: 1 going forward, -1 coming back. */
  arrivingFrom: 1 | -1;
  leaving: "forward" | "back" | null;
  onPress: () => void;
  /** The face of this character moves, so its drawing cannot be cached. */
  animated: boolean;
  children: ReactNode;
}) {
  const offset = index - choice;
  // Forward, everyone comes in from the right. Coming back, the neighbours come in from their sides,
  // and the chosen one shows in place when the hero has landed on it.
  const fromX = arrivingFrom === 1 ? ARRIVE_FROM : Math.sign(offset) * ARRIVE_FROM * 0.6;
  const arrival =
    arrivingFrom === -1 && offset === 0
      ? handOffEntering(motion, HERO_LANDS_MS)
      : arriveEntering(motion, fromX, 40 + Math.abs(offset) * ARRIVE_STAGGER_MS);
  // Forward, the chosen one stays for the hero and the others step aside; back, all go right.
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
          transform: [{ translateX: leaving && !staying ? away * STEP_ASIDE : 0 }],
          transitionProperty: ["opacity", "transform"],
          transitionDuration: motion === "none" ? 0 : 280,
          transitionTimingFunction: EASE_OUT_CSS,
        }}
      >
        {/* A character with a still face is drawn once and moved as a cached image: its filter
            and mask are not drawn again on each frame of a swipe. */}
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

/**
 * A soft light in the colour of one choice. It shows while that choice is in the middle, and fades
 * once per change of choice rather than on each frame of a swipe: a large blurred shadow is
 * expensive to compose.
 */
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

/** The first agent: swipe through the starting roles, or start from scratch at the end. */
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
  /** The position of the picker, shared with the colour behind the whole flow. */
  progress: SharedValue<number>;
  /** The characters are leaving: forward to the next step, or back to the welcome. */
  leaving: "forward" | "back" | null;
  /** The direction the step came from. */
  direction: 1 | -1;
  onChoiceChange: (index: number) => void;
}) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const muted = String(useThemeColor("muted"));
  // The flow pads the steps by the side insets, so the stage is that much narrower than the column.
  const stageWidth = useColumnWidth() - insets.left - insets.right;
  const side = (stageWidth - ITEM_WIDTH) / 2;
  const last = CHOICE_COUNT - 1;
  const full = motion === "full";

  // The stage follows a finger anywhere on the step, not only on the characters. Past the first
  // and the last choice it resists, and on release it springs to the nearest choice with the speed
  // of the finger, so a flick carries on.
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
          progress.set(rubberBand(start.get() - event.translationX / ITEM_WIDTH, last));
        })
        .onEnd((event) => {
          const velocity = -event.velocityX / ITEM_WIDTH;
          const target = Math.max(0, Math.min(last, Math.round(progress.get() + velocity * MOMENTUM_SECONDS)));
          progress.set(
            full
              ? withSpring(target, { ...SNAP_SPRING, velocity, reduceMotion: ReduceMotion.Never })
              : withTiming(target, REDUCED_SNAP),
          );
        }),
    [full, last, progress, start],
  );
  // A character that reaches the middle ticks like a picker detent: once per character, never
  // per frame.
  // Faces stay still while the stage moves: a change of face redraws a filter and a mask on each
  // frame. The character in the middle smiles once the stage has come to rest.
  const [settled, setSettled] = useState(choice);
  useEffect(() => {
    if (settled === choice) return;
    const timer = setTimeout(() => setSettled(choice), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [choice, settled]);
  // The smile goes as soon as the character leaves the middle. That character keeps drawing live
  // until its face has relaxed, so it eases back instead of jumping; then it is cached again.
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
  // The text slides in from the side the user swipes towards.
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
  /** Brings a choice to the middle, after a tap or an accessibility action. */
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
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -progress.get() * ITEM_WIDTH }] }));

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
            {/* The hero takes over from the character in the middle when the user goes on. */}
            <View className="absolute">
              <HeroSlot size={AVATAR_SIZE} />
            </View>
            {/* The shadow of the character in the middle keeps it standing on the stage. */}
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
                  {/* Each SVG frame of a face redraws a mask and a filter, so only the
                    character in the middle animates. The others hold their face. */}
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
                {/* The same size as the body of a character, not its whole frame. */}
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
            className="items-center gap-2 px-8"
            style={{
              opacity: leaving ? 0 : 1,
              transitionProperty: "opacity",
              transitionDuration: motion === "none" ? 0 : 200,
              transitionTimingFunction: EASE_OUT_CSS,
            }}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            {/* The name and the text fade to the next ones in place. */}
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
            {/* The old text fades out and the new one in, in the same place. */}
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
      </View>
    </GestureDetector>
  );
}
