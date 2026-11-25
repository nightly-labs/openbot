import { useEffect, useRef } from "react";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { CreditStar } from "@/features/settings/components/credit-star";

export interface MotionPoint {
  x: number;
  y: number;
}

export interface CreditSparkPath {
  bend: number;
  lift: number;
}

export type CreditTileMotion = ReturnType<typeof useCreditTileMotion>;

const CREDIT_FLIGHT_MS = 500;
const HIT_EASING = Easing.bezier(0.23, 1, 0.32, 1);
const FLIGHT_EASING = Easing.bezier(0.4, 0, 0.2, 1);
const CHARGE_EASING = Easing.bezier(0.45, 0, 0.55, 1);
const KNOCK_PEAK_MS = 66;
const KNOCK_BACK_MS = 108;
const KNOCK_SETTLE_MS = 126;
const KNOCK_DISTANCE = 7;
const KNOCK_REBOUND = 2.5;
const KNOCK_TILT = 8;
const KNOCK_TILT_REBOUND = 3;
const KNOCK_GROW = 0.06;
const RECOIL_SCALE = 0.88;
const CHARGE_SCALE = 1.07;
const CHARGE_MS = 520;
const RING_MS = 520;
const RING_START_SCALE = 0.85;
const RING_END_SCALE = 1.35;
const BURST_MS = 440;
const BURST_DOTS = 7;
const BURST_DOT_SIZE = 6;
const BURST_RADIUS = 26;
const BURST_RADIUS_STEP = 8;

function controlPoint(from: MotionPoint, to: MotionPoint, path: CreditSparkPath): MotionPoint {
  return { x: Math.max(from.x, to.x) + path.bend, y: (from.y + to.y) / 2 + path.lift };
}

export function creditSparkDirection(from: MotionPoint, to: MotionPoint, path: CreditSparkPath): MotionPoint {
  const control = controlPoint(from, to, path);
  const x = Math.sign(to.x - control.x) || 0.2;
  const y = Math.sign(to.y - control.y);
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

export function useCreditTileMotion() {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const rotate = useSharedValue(0);
  const scale = useSharedValue(1);
  const ringOpacity = useSharedValue(0);
  const ringScale = useSharedValue(RING_START_SCALE);
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.get() },
      { translateY: y.get() },
      { rotate: `${rotate.get()}deg` },
      { scale: scale.get() },
    ],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: ringOpacity.get(),
    transform: [{ scale: ringScale.get() }],
  }));
  const bounce = (peak: number, rebound: number) =>
    withSequence(
      withTiming(peak, { duration: KNOCK_PEAK_MS, easing: HIT_EASING }),
      withTiming(rebound, { duration: KNOCK_BACK_MS, easing: HIT_EASING }),
      withTiming(0, { duration: KNOCK_SETTLE_MS, easing: HIT_EASING }),
    );
  return {
    style,
    ringStyle,
    knock(direction: MotionPoint, strength: number) {
      x.set(bounce(direction.x * KNOCK_DISTANCE * strength, -direction.x * KNOCK_REBOUND * strength));
      y.set(bounce(direction.y * KNOCK_DISTANCE * strength, -direction.y * KNOCK_REBOUND * strength));
      rotate.set(bounce(direction.x * KNOCK_TILT * strength, -direction.x * KNOCK_TILT_REBOUND * strength));
      scale.set(
        withSequence(
          withTiming(1 + KNOCK_GROW * strength, { duration: KNOCK_PEAK_MS, easing: HIT_EASING }),
          withTiming(1, { duration: KNOCK_BACK_MS + KNOCK_SETTLE_MS, easing: HIT_EASING }),
        ),
      );
    },
    recoil() {
      scale.set(
        withSequence(
          withTiming(RECOIL_SCALE, { duration: KNOCK_PEAK_MS, easing: HIT_EASING }),
          withTiming(1, { duration: KNOCK_BACK_MS + KNOCK_PEAK_MS, easing: HIT_EASING }),
        ),
      );
    },
    charge(active: boolean) {
      scale.set(
        active
          ? withRepeat(withTiming(CHARGE_SCALE, { duration: CHARGE_MS, easing: CHARGE_EASING }), -1, true)
          : withTiming(1, { duration: KNOCK_BACK_MS, easing: HIT_EASING }),
      );
    },
    ring() {
      ringOpacity.set(
        withSequence(withTiming(0.9, { duration: 0 }), withTiming(0, { duration: RING_MS, easing: HIT_EASING })),
      );
      ringScale.set(
        withSequence(
          withTiming(RING_START_SCALE, { duration: 0 }),
          withTiming(RING_END_SCALE, { duration: RING_MS, easing: HIT_EASING }),
        ),
      );
    },
  };
}

export function CreditSpark({
  from,
  to,
  path,
  size,
  onLand,
}: {
  from: MotionPoint;
  to: MotionPoint;
  path: CreditSparkPath;
  size: number;
  onLand: () => void;
}) {
  const progress = useSharedValue(0);
  const landing = useRef(onLand);
  landing.current = onLand;
  useEffect(() => {
    const land = () => landing.current();
    progress.set(
      withTiming(1, { duration: CREDIT_FLIGHT_MS, easing: FLIGHT_EASING }, (finished) => {
        if (finished) scheduleOnRN(land);
      }),
    );
  }, [progress]);
  const control = controlPoint(from, to, path);
  const style = useAnimatedStyle(() => {
    const t = progress.get();
    const u = 1 - t;
    const x = u * u * from.x + 2 * u * t * control.x + t * t * to.x;
    const y = u * u * from.y + 2 * u * t * control.y + t * t * to.y;
    const scale = t < 0.45 ? 0.55 + t : 1 - (t - 0.45) * 0.9;
    return {
      opacity: t < 0.1 ? t / 0.1 : 1,
      transform: [{ translateX: x - size / 2 }, { translateY: y - size / 2 }, { rotate: `${t * 160}deg` }, { scale }],
    };
  });
  return (
    <Animated.View pointerEvents="none" className="absolute top-0 left-0" style={style}>
      <CreditStar size={size} />
    </Animated.View>
  );
}

const BURST_PATHS = Array.from({ length: BURST_DOTS }, (_, index) => ({
  id: `burst-${index}`,
  angle: (index / BURST_DOTS) * Math.PI * 2 + 0.3,
  radius: BURST_RADIUS + (index % 2) * BURST_RADIUS_STEP,
}));

export function CreditBurst({ center, color }: { center: MotionPoint; color: string }) {
  return BURST_PATHS.map((dot) => (
    <CreditBurstDot key={dot.id} center={center} color={color} angle={dot.angle} radius={dot.radius} />
  ));
}

function CreditBurstDot({
  center,
  color,
  angle,
  radius,
}: {
  center: MotionPoint;
  color: string;
  angle: number;
  radius: number;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(withTiming(1, { duration: BURST_MS, easing: HIT_EASING }));
  }, [progress]);
  const style = useAnimatedStyle(() => {
    const t = progress.get();
    return {
      opacity: 1 - t,
      transform: [
        { translateX: center.x + Math.cos(angle) * radius * t - BURST_DOT_SIZE / 2 },
        { translateY: center.y + Math.sin(angle) * radius * t - BURST_DOT_SIZE / 2 },
        { scale: 1 - 0.8 * t },
      ],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      className="absolute top-0 left-0 rounded-full"
      style={[{ width: BURST_DOT_SIZE, height: BURST_DOT_SIZE, backgroundColor: color }, style]}
    />
  );
}
