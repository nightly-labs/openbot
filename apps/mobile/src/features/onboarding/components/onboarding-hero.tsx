import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { View, type ViewInstance } from "react-native";
import Animated, {
  cancelAnimation,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { useAgentColorTransition } from "@/features/agents/components/agent-color-glow";
import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { getBloubAvatarColor } from "@/features/agents/model/bloub-activity";
import type { OnboardingMotion } from "@/features/onboarding/components/onboarding-motion";
import { SPLASH_EASE_OUT } from "@/shared/lib/splash-motion";

/** The hero is drawn at this size and scaled down to each slot, so it stays sharp. */
const HERO_SIZE = 180;
const GLOW_SIZE = 260;
// The hero moves between slots like a body with weight: it overshoots a little and settles.
const FLIGHT = { duration: 620, dampingRatio: 0.82, reduceMotion: ReduceMotion.Never };
const FADE = { duration: 160, easing: SPLASH_EASE_OUT, reduceMotion: ReduceMotion.Never };
/**
 * A flight has as good as landed after this time. Back on the picker, the character there shows
 * at this moment, under the hero, and the hero fades off it.
 */
export const HERO_LANDS_MS = 400;
// A step slides in for 300 ms. The slot is measured again when the slide is over.
const SETTLED_MEASURE_MS = 340;
// The hero draws until its fade-out is over.
const HIDE_LINGER_MS = HERO_LANDS_MS + FADE.duration + 80;

/** Where a step wants the hero: the centre and the size, in window coordinates. */
export interface HeroSlotRect {
  cx: number;
  cy: number;
  size: number;
}

const HeroSlotContext = createContext<((rect: HeroSlotRect) => void) | null>(null);
export const HeroSlotProvider = HeroSlotContext.Provider;

/**
 * An empty space in a step where the hero stands. The hero itself lives above the steps, so one
 * character travels from step to step instead of each step drawing its own.
 */
export function HeroSlot({ size }: { size: number }) {
  const report = useContext(HeroSlotContext);
  const slot = useRef<ViewInstance>(null);
  const measure = useCallback(() => {
    slot.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) report?.({ cx: x + width / 2, cy: y + height / 2, size: width });
    });
  }, [report]);
  // The first measure can include the slide of the step; the second one is exact. The hero's
  // spring takes the new target in its stride.
  useEffect(() => {
    const settled = setTimeout(measure, SETTLED_MEASURE_MS);
    return () => clearTimeout(settled);
  }, [measure]);
  return (
    <View
      ref={slot}
      collapsable={false}
      pointerEvents="none"
      onLayout={measure}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    />
  );
}

/**
 * The agent that the user is making. It flies to the slot of each step, keeps its colour as the
 * colour changes, hops when it is created, and follows a finger while the user swipes its look.
 * Only views move: the SVG keeps its own props (an animated opacity on its filtered group crashes
 * Android).
 */
export function OnboardingHero({
  seed,
  hue,
  mood,
  slot,
  origin,
  visible,
  motion,
  drag,
  pulse,
  celebrate,
}: {
  seed: string;
  hue: AvatarHue | null;
  mood: AvatarMood;
  /** The target, in window coordinates. */
  slot: HeroSlotRect | null;
  /** The window position of the layer that holds the hero. */
  origin: { x: number; y: number };
  visible: boolean;
  motion: OnboardingMotion;
  /** A horizontal offset that a swipe adds, in points. */
  drag: SharedValue<number>;
  /** A change of this number plays a small squash, for example when the look changes. */
  pulse: number;
  celebrate: boolean;
}) {
  const full = motion === "full";
  const cx = useSharedValue(0);
  const cy = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);
  const squash = useSharedValue(1);
  const hop = useSharedValue(0);
  const placed = useRef(false);
  // Hidden, the hero draws nothing: a picker swipe changes its look and colour, and an unseen
  // filtered SVG must not be drawn again for each one. It keeps drawing, with a live face, from the
  // render that hides it until its fade-out is over: drawn again, it would start blank and with a
  // new face.
  const [drawn, setDrawn] = useState(visible);
  if (visible && !drawn) setDrawn(true);
  useEffect(() => {
    if (visible) return;
    const timer = setTimeout(() => setDrawn(false), HIDE_LINGER_MS);
    return () => clearTimeout(timer);
  }, [visible]);
  const color = useAgentColorTransition(getBloubAvatarColor(seed, hue));

  useLayoutEffect(() => {
    if (!slot) return;
    const x = slot.cx - origin.x;
    const y = slot.cy - origin.y;
    const s = slot.size / HERO_SIZE;
    // The first slot places the hero without a flight. Later slots fly, unless motion is reduced.
    if (!placed.current || !full) {
      placed.current = true;
      cx.set(x);
      cy.set(y);
      scale.set(s);
      return;
    }
    cx.set(withSpring(x, FLIGHT));
    cy.set(withSpring(y, FLIGHT));
    scale.set(withSpring(s, FLIGHT));
  }, [cx, cy, full, origin.x, origin.y, scale, slot]);

  useEffect(() => {
    cancelAnimation(opacity);
    // It appears at once where the step left its character, and fades only on the way out, when it
    // has landed on the picker and the character there has taken over.
    opacity.set(visible ? 1 : withDelay(full ? HERO_LANDS_MS : 0, withTiming(0, FADE)));
  }, [full, opacity, visible]);

  useEffect(() => {
    if (pulse === 0 || !full) return;
    squash.set(
      withSequence(
        withTiming(0.9, { duration: 90, easing: SPLASH_EASE_OUT, reduceMotion: ReduceMotion.Never }),
        withSpring(1, { duration: 360, dampingRatio: 0.55, reduceMotion: ReduceMotion.Never }),
      ),
    );
  }, [full, pulse, squash]);

  useEffect(() => {
    if (!celebrate || !full) return;
    // A hop of joy once it lands in the last step.
    hop.set(
      withDelay(
        380,
        withSequence(
          withTiming(-22, { duration: 200, easing: SPLASH_EASE_OUT, reduceMotion: ReduceMotion.Never }),
          withSpring(0, { duration: 560, dampingRatio: 0.45, reduceMotion: ReduceMotion.Never }),
        ),
        ReduceMotion.Never,
      ),
    );
  }, [celebrate, full, hop]);

  const heroStyle = useAnimatedStyle(() => {
    const offset = drag.get();
    return {
      opacity: opacity.get(),
      transform: [
        { translateX: cx.get() - HERO_SIZE / 2 + offset },
        { translateY: cy.get() - HERO_SIZE / 2 + hop.get() },
        { scale: scale.get() * squash.get() },
        { rotate: `${offset / 18}deg` },
      ],
    };
  });
  // The glow belongs to the large slots. Next to a title it would only blur the text. Only its
  // opacity animates: a shadow redrawn on every frame is expensive on Android.
  const glowColor = getBloubAvatarColor(seed, hue);
  const glowStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, (scale.get() * HERO_SIZE - 70) / 50)),
  }));

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ position: "absolute", left: 0, top: 0, width: HERO_SIZE, height: HERO_SIZE }, heroStyle]}
    >
      <Animated.View
        style={[
          {
            position: "absolute",
            left: (HERO_SIZE - GLOW_SIZE) / 2,
            top: (HERO_SIZE - GLOW_SIZE) / 2,
            width: GLOW_SIZE,
            height: GLOW_SIZE,
            borderRadius: GLOW_SIZE / 2,
            backgroundColor: `${glowColor}2e`,
            boxShadow: `0 0 80px 30px ${glowColor}3d`,
          },
          glowStyle,
        ]}
      />
      {/* Only the hero animates its face while it shows; hidden, it is not drawn at all. */}
      {drawn ? (
        <BloubAvatarPreview
          seed={seed}
          hue={hue}
          size={HERO_SIZE}
          mood={mood}
          animateIdle={full}
          animatedColor={color}
        />
      ) : null}
    </Animated.View>
  );
}
