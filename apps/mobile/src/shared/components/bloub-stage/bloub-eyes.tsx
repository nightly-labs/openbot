import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  interpolateColor,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { SPLASH_EASE_IN_OUT, SPLASH_EASE_OUT } from "@/shared/lib/splash-motion";
import type { BloubMood } from "./bloub-stage-store";

export const EYES_WIDTH = 220;
export const EYES_HEIGHT = 170;
const EYE_WIDTH = 66;
const EYE_HEIGHT = 160;
const EYE_INSET = 18;
const FRAME_OUTSET_X = 15;
const FRAME_OUTSET_Y = 40;
const ARM_LENGTH = 46;
const ARM_THICKNESS = 6;
const ARM_STAGGER_MS = 40;
const ARM_MS = 220;
const ARM_DELAY_MS = 520;

const MOOD = { duration: 500, easing: SPLASH_EASE_IN_OUT };
const BLINK_CLOSED = 0.08;
const FRAME_COLOR = "#ffffff";
const FRAME_TINT_DELAY_MS = 500;

interface EyePose {
  x: number;
  y: number;
  rotate: number;
  scaleX: number;
  scaleY: number;
}

const OPEN: EyePose = { x: 0, y: 0, rotate: -10, scaleX: 1, scaleY: 1 };

function poseFor(mood: BloubMood, side: -1 | 1): EyePose {
  switch (mood) {
    case "down":
      return { ...OPEN, scaleY: 0.9 };
    case "sad":
      return { x: 0, y: 30, rotate: side < 0 ? 4 : -24, scaleX: 1, scaleY: 0.42 };
    case "happy":
      return { ...OPEN, rotate: 0 };
    case "joy":
      return { ...OPEN, rotate: 0, scaleX: 1.08, scaleY: 1.08 };
    case "cry":
      return { x: 0, y: 8, rotate: side < 0 ? -16 : 16, scaleX: 1, scaleY: 1 };
    case "meh":
      return side < 0
        ? { x: 0, y: 32, rotate: 0, scaleX: 1, scaleY: 0.3 }
        : { x: 0, y: 26, rotate: -6, scaleX: 1, scaleY: 0.3 };
    case "frame":
    case "found":
      return { x: 66 * side, y: 5, rotate: 0, scaleX: 0.09, scaleY: 1.56 };
    default:
      return OPEN;
  }
}

const isFrame = (mood: BloubMood) => mood === "frame" || mood === "found";
const isClosed = (mood: BloubMood) => mood === "happy" || mood === "joy" || mood === "cry";

const SQUISH_MS = 900;
const SWING_DEG = 9;
const SWING_X = 8;
const SWING_HALF_MS = 350;
const SWAY_ORIGIN = "50% 85%";
const TREMBLE = [-3, 3, -2, 2, 0];
const TREMBLE_STEP_MS = 96;
const TEAR_FALL = 56;
const TEAR_MS = 1500;
const TEAR_COLOR = "#74b9ff";

type Glance = readonly [x: number, y: number, moveMs: number, holdMs: number];

const IDLE_GLANCES: readonly Glance[] = [
  [0, 0, 0, 2080],
  [-14, 2, 480, 1440],
  [0, 0, 800, 0],
  [12, -5, 480, 1600],
  [0, 0, 1120, 0],
];
const THINK_GLANCES: readonly Glance[] = [
  [-12, -10, 420, 900],
  [11, -8, 520, 700],
  [-3, -13, 380, 500],
  [0, -4, 420, 600],
];

function glanceLoop(glances: readonly Glance[], axis: 0 | 1, delayMs: number): number {
  const steps = glances.flatMap(([x, y, moveMs, holdMs]) => {
    const to = axis === 0 ? x : y;
    return [
      withTiming(to, { duration: moveMs, easing: SPLASH_EASE_IN_OUT }),
      withDelay(holdMs, withTiming(to, { duration: 0 })),
    ];
  });
  const [first, ...rest] = steps;
  return withDelay(delayMs, withRepeat(withSequence(first ?? 0, ...rest), -1));
}

function blinkOnce(): number[] {
  return [
    withTiming(BLINK_CLOSED, { duration: 144, easing: SPLASH_EASE_IN_OUT }),
    withTiming(1, { duration: 192, easing: SPLASH_EASE_IN_OUT }),
  ];
}

function Eye({
  side,
  mood,
  reduced,
  blink,
  tint,
  eyeColor,
}: {
  side: -1 | 1;
  mood: BloubMood;
  reduced: boolean;
  blink: SharedValue<number>;
  tint: SharedValue<number>;
  eyeColor: string;
}) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const rotate = useSharedValue(OPEN.rotate);
  const scaleX = useSharedValue(1);
  const scaleY = useSharedValue(1);
  const closed = useSharedValue(0);
  const smile = useSharedValue(0);
  const flip = useSharedValue(1);

  useEffect(() => {
    const pose = poseFor(mood, side);
    const to = (value: number) => (reduced ? value : withTiming(value, MOOD));
    x.set(to(pose.x));
    y.set(to(pose.y));
    rotate.set(to(pose.rotate));
    scaleX.set(to(pose.scaleX));
    scaleY.set(to(pose.scaleY));
    const shut = isClosed(mood);
    closed.set(withTiming(shut ? 1 : 0, { duration: reduced ? 160 : shut ? 200 : 300, easing: SPLASH_EASE_OUT }));
    smile.set(
      reduced
        ? withTiming(shut ? 1 : 0, { duration: 160 })
        : shut
          ? withDelay(80, withTiming(1, { duration: 360, easing: SPLASH_EASE_OUT }))
          : withTiming(0, { duration: 200, easing: SPLASH_EASE_OUT }),
    );
    const turned = mood === "cry" ? -0.8 : 1;
    flip.set(reduced ? turned : withTiming(turned, { duration: 240, easing: SPLASH_EASE_OUT }));
  }, [closed, flip, mood, reduced, rotate, scaleX, scaleY, side, smile, x, y]);

  const eyeStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.get() },
      { translateY: y.get() },
      { rotate: `${rotate.get()}deg` },
      { scaleX: scaleX.get() },
      { scaleY: scaleY.get() },
    ],
  }));
  const capsuleStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(tint.get(), [0, 1], [eyeColor, FRAME_COLOR]),
    opacity: 1 - closed.get(),
    transform: [{ scaleY: blink.get() * (1 - 0.8 * closed.get()) }],
  }));
  const smileStyle = useAnimatedStyle(() => {
    const grow = 0.8 + 0.2 * smile.get();
    return {
      opacity: Math.min(1, smile.get() * 1.8),
      transform: [{ translateY: 16 * (1 - smile.get()) }, { scaleX: grow }, { scaleY: grow * flip.get() }],
    };
  });

  return (
    <Animated.View style={[styles.eye, side < 0 ? { left: EYE_INSET } : { right: EYE_INSET }, eyeStyle]}>
      <Animated.View style={[styles.capsule, capsuleStyle]} />
      <Animated.View style={[styles.smile, smileStyle]}>
        <Svg width="100%" height="100%" viewBox="0 0 78 44">
          <Path d="M10 36 Q39 -4 68 36" fill="none" stroke={eyeColor} strokeWidth={18} strokeLinecap="round" />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

const ARMS = [
  { key: "tl", style: { left: -3, top: 0, transformOrigin: "left" } },
  { key: "tr", style: { right: -3, top: 0, transformOrigin: "right" } },
  { key: "bl", style: { left: -3, bottom: 0, transformOrigin: "left" } },
  { key: "br", style: { right: -3, bottom: 0, transformOrigin: "right" } },
] as const;

function Arm({
  index,
  frame,
  tint,
  eyeColor,
  position,
}: {
  index: number;
  frame: SharedValue<number>;
  tint: SharedValue<number>;
  eyeColor: string;
  position: (typeof ARMS)[number]["style"];
}) {
  const span = ARM_MS + ARM_STAGGER_MS * (ARMS.length - 1);
  const style = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(tint.get(), [0, 1], [eyeColor, FRAME_COLOR]),
    transform: [{ scaleX: Math.min(1, Math.max(0, (frame.get() * span - index * ARM_STAGGER_MS) / ARM_MS)) }],
  }));
  return <Animated.View style={[styles.arm, position, style]} />;
}

function Tear({ side, crying, reduced }: { side: -1 | 1; crying: boolean; reduced: boolean }) {
  const fall = useSharedValue(0);
  const shown = useSharedValue(0);
  useEffect(() => {
    if (!crying) {
      cancelAnimation(fall);
      shown.set(withTiming(0, { duration: reduced ? 0 : 160, easing: SPLASH_EASE_OUT }));
      return;
    }
    if (reduced) {
      fall.set(0.3);
      shown.set(1);
      return;
    }
    const start = side < 0 ? 300 : 1000;
    fall.set(
      withDelay(
        start,
        withRepeat(
          withSequence(
            withTiming(0, { duration: 0 }),
            withTiming(1, { duration: TEAR_MS, easing: SPLASH_EASE_IN_OUT }),
          ),
          -1,
        ),
      ),
    );
    shown.set(withDelay(start, withTiming(1, { duration: 0 })));
    return () => cancelAnimation(fall);
  }, [crying, fall, reduced, shown, side]);
  const style = useAnimatedStyle(() => {
    const value = fall.get();
    const opacity = value < 0.2 ? value / 0.2 : value > 0.8 ? (1 - value) / 0.2 : 1;
    return {
      opacity: shown.get() * opacity,
      transform: [{ translateY: -6 + value * (TEAR_FALL + 6) }, { scale: value < 0.2 ? 0.4 + 3 * value : 1 }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.tear, side < 0 ? { left: EYE_INSET + 26 } : { right: EYE_INSET + 26 }, style]}
    />
  );
}

export function BloubEyes({
  mood,
  active,
  reduced,
  gazeX,
  gazeY,
  eyeColor,
}: {
  mood: BloubMood;
  active: boolean;
  reduced: boolean;
  gazeX: SharedValue<number>;
  gazeY: SharedValue<number>;
  eyeColor: string;
}) {
  const wanderX = useSharedValue(0);
  const wanderY = useSharedValue(0);
  const blink = useSharedValue(1);
  const frame = useSharedValue(0);
  const tint = useSharedValue(0);
  const sway = useSharedValue(0);
  const squashX = useSharedValue(1);
  const squashY = useSharedValue(1);

  useEffect(() => {
    const loops = active && !reduced;
    const glances = mood === "idle" ? IDLE_GLANCES : mood === "think" ? THINK_GLANCES : null;
    const settle = { duration: reduced ? 0 : 240, easing: SPLASH_EASE_OUT };
    if (loops && mood === "joy") {
      const squish = (down: number, up: number) =>
        withSequence(
          withTiming(down, { duration: 200, easing: SPLASH_EASE_OUT }),
          withTiming(up, { duration: 230, easing: SPLASH_EASE_IN_OUT }),
          withTiming(1, { duration: SQUISH_MS - 430, easing: SPLASH_EASE_OUT }),
        );
      squashX.set(squish(1.08, 0.97));
      squashY.set(squish(0.9, 1.04));
      wanderY.set(
        withSequence(
          withTiming(16, { duration: 200, easing: SPLASH_EASE_OUT }),
          withTiming(-6, { duration: 230, easing: SPLASH_EASE_IN_OUT }),
          withTiming(0, { duration: SQUISH_MS - 430, easing: SPLASH_EASE_OUT }),
        ),
      );
      const swing = (reach: number) =>
        withDelay(
          SQUISH_MS,
          withRepeat(
            withSequence(
              withTiming(-reach, { duration: SWING_HALF_MS, easing: SPLASH_EASE_IN_OUT }),
              withTiming(reach, { duration: SWING_HALF_MS * 2, easing: SPLASH_EASE_IN_OUT }),
              withTiming(0, { duration: SWING_HALF_MS, easing: SPLASH_EASE_IN_OUT }),
            ),
            -1,
          ),
        );
      sway.set(swing(SWING_DEG));
      wanderX.set(swing(SWING_X));
    } else if (loops && mood === "cry") {
      sway.set(withTiming(0, settle));
      squashX.set(withTiming(1, settle));
      squashY.set(withTiming(1, settle));
      wanderY.set(withTiming(0, settle));
      const [first = 0, ...rest] = TREMBLE.map((to) => withTiming(to, { duration: TREMBLE_STEP_MS }));
      wanderX.set(withSequence(first, ...rest));
    } else if (loops && glances) {
      sway.set(withTiming(0, settle));
      squashX.set(withTiming(1, settle));
      squashY.set(withTiming(1, settle));
      const delay = mood === "idle" ? 1600 : 120;
      wanderX.set(
        withSequence(withTiming(0, { duration: 240, easing: SPLASH_EASE_OUT }), glanceLoop(glances, 0, delay)),
      );
      wanderY.set(
        withSequence(withTiming(0, { duration: 240, easing: SPLASH_EASE_OUT }), glanceLoop(glances, 1, delay)),
      );
    } else {
      sway.set(withTiming(0, settle));
      squashX.set(withTiming(1, settle));
      squashY.set(withTiming(1, settle));
      wanderX.set(withTiming(0, settle));
      wanderY.set(withTiming(0, settle));
    }
    if (loops && (mood === "idle" || mood === "down")) {
      blink.set(
        withDelay(1200, withRepeat(withSequence(withDelay(4464, withTiming(1, { duration: 0 })), ...blinkOnce()), -1)),
      );
    } else if (loops && mood === "think") {
      blink.set(
        withRepeat(withSequence(withDelay(2600, withTiming(1, { duration: 0 })), ...blinkOnce(), ...blinkOnce()), -1),
      );
    } else {
      blink.set(withTiming(1, { duration: reduced ? 0 : 120 }));
    }
    tint.set(
      isFrame(mood)
        ? withDelay(
            reduced ? 0 : FRAME_TINT_DELAY_MS,
            withTiming(1, { duration: reduced ? 160 : 600, easing: SPLASH_EASE_IN_OUT }),
          )
        : withTiming(0, { duration: reduced ? 160 : 400, easing: SPLASH_EASE_OUT }),
    );
    frame.set(
      isFrame(mood)
        ? reduced
          ? withTiming(1, { duration: 160 })
          : withDelay(ARM_DELAY_MS, withTiming(1, { duration: ARM_MS + ARM_STAGGER_MS * (ARMS.length - 1) }))
        : withTiming(0, { duration: reduced ? 0 : ARM_MS, easing: SPLASH_EASE_OUT }),
    );
    return () => {
      cancelAnimation(wanderX);
      cancelAnimation(wanderY);
      cancelAnimation(blink);
      cancelAnimation(sway);
      cancelAnimation(squashX);
      cancelAnimation(squashY);
    };
  }, [active, blink, frame, mood, reduced, squashX, squashY, sway, tint, wanderX, wanderY]);

  const lookStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: gazeX.get() + wanderX.get() },
      { translateY: gazeY.get() + wanderY.get() },
      { rotate: `${sway.get()}deg` },
      { scaleX: squashX.get() },
      { scaleY: squashY.get() },
    ],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: SWAY_ORIGIN }, lookStyle]}>
      <Eye side={-1} mood={mood} reduced={reduced} blink={blink} tint={tint} eyeColor={eyeColor} />
      <Eye side={1} mood={mood} reduced={reduced} blink={blink} tint={tint} eyeColor={eyeColor} />
      <Tear side={-1} crying={mood === "cry" && active} reduced={reduced} />
      <Tear side={1} crying={mood === "cry" && active} reduced={reduced} />
      <View style={styles.frame}>
        {ARMS.map((arm, index) => (
          <Arm key={arm.key} index={index} frame={frame} tint={tint} eyeColor={eyeColor} position={arm.style} />
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  eye: { position: "absolute", top: 0, width: EYE_WIDTH, height: EYE_HEIGHT },
  capsule: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: EYE_WIDTH / 2 },
  smile: { position: "absolute", left: -6, top: 56, width: 78, height: 44 },
  frame: {
    position: "absolute",
    left: -FRAME_OUTSET_X,
    right: -FRAME_OUTSET_X,
    top: -FRAME_OUTSET_Y,
    bottom: -FRAME_OUTSET_Y,
  },
  arm: { position: "absolute", width: ARM_LENGTH, height: ARM_THICKNESS, borderRadius: ARM_THICKNESS / 2 },
  tear: {
    position: "absolute",
    top: 104,
    width: 14,
    height: 20,
    borderRadius: 7,
    backgroundColor: TEAR_COLOR,
  },
});
