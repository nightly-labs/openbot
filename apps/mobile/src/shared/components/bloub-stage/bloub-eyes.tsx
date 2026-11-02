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

/** The box that holds both eyes, in points at scale 1. */
export const EYES_WIDTH = 220;
export const EYES_HEIGHT = 170;
const EYE_WIDTH = 66;
const EYE_HEIGHT = 160;
const EYE_INSET = 18;
// The scanner frame: the eyes become its two sides, and four arms finish the corners.
const FRAME_OUTSET_X = 15;
const FRAME_OUTSET_Y = 40;
const ARM_LENGTH = 46;
const ARM_THICKNESS = 6;
const ARM_STAGGER_MS = 40;
const ARM_MS = 220;
// The arms start when the sides have mostly stretched.
const ARM_DELAY_MS = 520;

const MOOD = { duration: 500, easing: SPLASH_EASE_IN_OUT };
const BLINK_CLOSED = 0.08;
// The scanner frame over the camera.
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
    case "frame":
    case "found":
      // A thin, tall bar on each side of the frame.
      return { x: 66 * side, y: 5, rotate: 0, scaleX: 0.09, scaleY: 1.56 };
    default:
      return OPEN;
  }
}

const isFrame = (mood: BloubMood) => mood === "frame" || mood === "found";

/** A move of the gaze: where to, how long the move takes, and how long the eyes stay. */
type Glance = readonly [x: number, y: number, moveMs: number, holdMs: number];

// The eyes look left, then right, while the user decides.
const IDLE_GLANCES: readonly Glance[] = [
  [0, 0, 0, 2080],
  [-14, 2, 480, 1440],
  [0, 0, 800, 0],
  [12, -5, 480, 1600],
  [0, 0, 1120, 0],
];
// Thinking: up and to the side, across, up again, and back.
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
  /** 0 is the eye color, 1 the white of the scanner frame. */
  tint: SharedValue<number>;
  eyeColor: string;
}) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const rotate = useSharedValue(OPEN.rotate);
  const scaleX = useSharedValue(1);
  const scaleY = useSharedValue(1);
  // Happy closes the capsule, and a smiling arc takes its place.
  const closed = useSharedValue(0);
  const smile = useSharedValue(0);

  useEffect(() => {
    const pose = poseFor(mood, side);
    const to = (value: number) => (reduced ? value : withTiming(value, MOOD));
    x.set(to(pose.x));
    y.set(to(pose.y));
    rotate.set(to(pose.rotate));
    scaleX.set(to(pose.scaleX));
    scaleY.set(to(pose.scaleY));
    const happy = mood === "happy";
    closed.set(withTiming(happy ? 1 : 0, { duration: reduced ? 160 : happy ? 200 : 300, easing: SPLASH_EASE_OUT }));
    smile.set(
      reduced
        ? withTiming(happy ? 1 : 0, { duration: 160 })
        : happy
          ? withDelay(80, withTiming(1, { duration: 360, easing: SPLASH_EASE_OUT }))
          : withTiming(0, { duration: 200, easing: SPLASH_EASE_OUT }),
    );
  }, [closed, mood, reduced, rotate, scaleX, scaleY, side, smile, x, y]);

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
  const smileStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, smile.get() * 1.8),
    transform: [{ translateY: 16 * (1 - smile.get()) }, { scale: 0.8 + 0.2 * smile.get() }],
  }));

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

/**
 * The two eyes of the stage. Every movement is a shared value on the UI thread: moods change the
 * eye transforms, and the idle and thinking glances loop there without the JS thread.
 */
export function BloubEyes({
  mood,
  active,
  reduced,
  gazeX,
  gazeY,
  eyeColor,
}: {
  mood: BloubMood;
  /** Off while the stage is hidden: no loop runs for eyes nobody sees. */
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

  useEffect(() => {
    const loops = active && !reduced;
    const glances = mood === "idle" ? IDLE_GLANCES : mood === "think" ? THINK_GLANCES : null;
    if (loops && glances) {
      // The idle glance waits until the screen has settled; thinking starts at once.
      const delay = mood === "idle" ? 1600 : 120;
      wanderX.set(
        withSequence(withTiming(0, { duration: 240, easing: SPLASH_EASE_OUT }), glanceLoop(glances, 0, delay)),
      );
      wanderY.set(
        withSequence(withTiming(0, { duration: 240, easing: SPLASH_EASE_OUT }), glanceLoop(glances, 1, delay)),
      );
    } else {
      wanderX.set(withTiming(0, { duration: reduced ? 0 : 240, easing: SPLASH_EASE_OUT }));
      wanderY.set(withTiming(0, { duration: reduced ? 0 : 240, easing: SPLASH_EASE_OUT }));
    }
    if (loops && (mood === "idle" || mood === "down")) {
      blink.set(
        withDelay(1200, withRepeat(withSequence(withDelay(4464, withTiming(1, { duration: 0 })), ...blinkOnce()), -1)),
      );
    } else if (loops && mood === "think") {
      // A double blink now and then, as when someone thinks hard.
      blink.set(
        withRepeat(withSequence(withDelay(2600, withTiming(1, { duration: 0 })), ...blinkOnce(), ...blinkOnce()), -1),
      );
    } else {
      blink.set(withTiming(1, { duration: reduced ? 0 : 120 }));
    }
    // Over the camera the frame turns white, so it shows on a dark picture. The color waits until
    // the block has mostly faded and the camera shows, so it changes gently; it goes back at once.
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
    };
  }, [active, blink, frame, mood, reduced, tint, wanderX, wanderY]);

  const lookStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: gazeX.get() + wanderX.get() }, { translateY: gazeY.get() + wanderY.get() }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, lookStyle]}>
      <Eye side={-1} mood={mood} reduced={reduced} blink={blink} tint={tint} eyeColor={eyeColor} />
      <Eye side={1} mood={mood} reduced={reduced} blink={blink} tint={tint} eyeColor={eyeColor} />
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
});
