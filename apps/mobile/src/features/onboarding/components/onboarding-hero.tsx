import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import type { AvatarColor, AvatarHue } from "@openbot/contracts/ipc";
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
import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import type { OnboardingMotion } from "@/features/onboarding/components/onboarding-motion";
import { SPLASH_EASE_OUT } from "@/shared/lib/splash-motion";

const HERO_SIZE = 180;
const GLOW_SIZE = 260;
const FLIGHT = { duration: 620, dampingRatio: 0.82, reduceMotion: ReduceMotion.Never };
const FADE = { duration: 160, easing: SPLASH_EASE_OUT, reduceMotion: ReduceMotion.Never };
export const HERO_LANDS_MS = 400;
const SETTLED_MEASURE_MS = 340;
const HIDE_LINGER_MS = HERO_LANDS_MS + FADE.duration + 80;

export interface HeroSlotRect {
  cx: number;
  cy: number;
  size: number;
}

const HeroSlotContext = createContext<((rect: HeroSlotRect) => void) | null>(null);
export const HeroSlotProvider = HeroSlotContext.Provider;

export function HeroSlot({ size }: { size: number }) {
  const report = useContext(HeroSlotContext);
  const slot = useRef<ViewInstance>(null);
  const measure = useCallback(() => {
    slot.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) report?.({ cx: x + width / 2, cy: y + height / 2, size: width });
    });
  }, [report]);
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

export function OnboardingHero({
  seed,
  hue,
  color,
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
  color: AvatarColor | null;
  mood: AvatarMood;
  slot: HeroSlotRect | null;
  origin: { x: number; y: number };
  visible: boolean;
  motion: OnboardingMotion;
  drag: SharedValue<number>;
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
  const [drawn, setDrawn] = useState(visible);
  if (visible && !drawn) setDrawn(true);
  useEffect(() => {
    if (visible) return;
    const timer = setTimeout(() => setDrawn(false), HIDE_LINGER_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  useLayoutEffect(() => {
    if (!slot) return;
    const x = slot.cx - origin.x;
    const y = slot.cy - origin.y;
    const s = slot.size / HERO_SIZE;
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
  const glowColor = avatarHeadColor(seed, hue, color);
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
      {drawn ? (
        <BloubAvatarPreview
          seed={seed}
          hue={hue}
          color={color}
          size={HERO_SIZE}
          mood={mood}
          animateIdle={full}
          transition="pop"
        />
      ) : null}
    </Animated.View>
  );
}
