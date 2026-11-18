import { type PropsWithChildren, useEffect, useId } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  type SharedValue,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import {
  ORBIT_CYCLE,
  type OrbitRing,
  orbitFrameIndex,
  orbitFrames,
  orbitRings,
  prepareOrbitFrames,
} from "@/features/agents/model/bloub-orbit";
import { useMotionPreference } from "@/shared/lib/motion";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import { useScreenFocusedWhile } from "@/shared/lib/use-screen-focused-while";

const AnimatedPath = Animated.createAnimatedComponent(Path);
/**
 * The desktop draws the face at 128% of the avatar box and the rings at 158%. The phone draws the
 * face in the box, so the rings reach past it by the same proportion.
 */
const RING_SCALE = 1.58 / 1.28;
const GRADIENT_OFFSETS = [0, 0.5, 1];

function OrbitArcPath({
  clock,
  gradientId,
  index,
  layer,
  ring,
}: {
  clock: SharedValue<number>;
  gradientId: string;
  index: number;
  layer: "back" | "front";
  ring: OrbitRing;
}) {
  const props = useAnimatedProps(() => {
    const frames = orbitFrames.get();
    const arc = frames.length > 0 ? frames[orbitFrameIndex(clock.get(), frames.length)]?.[index] : undefined;
    return { d: arc ? arc[layer] : "", opacity: arc ? arc.opacity : 0 };
  });
  return (
    <AnimatedPath
      fill="none"
      stroke={`url(#${gradientId})`}
      strokeLinecap="round"
      strokeWidth={ring.width}
      animatedProps={props}
    />
  );
}

function OrbitLayer({ clock, layer, size }: { clock: SharedValue<number>; layer: "back" | "front"; size: number }) {
  const id = `orbit-${useId().replaceAll(":", "")}`;
  const rings = orbitRings();
  const box = size * RING_SCALE;
  return (
    <Svg
      accessibilityElementsHidden
      accessible={false}
      height={box}
      pointerEvents="none"
      style={{ position: "absolute", left: (size - box) / 2, top: (size - box) / 2 }}
      viewBox="-158 -158 316 316"
      width={box}
    >
      <Defs>
        {rings.map((ring) => (
          <LinearGradient
            key={ring.id}
            id={`${id}-${ring.id}`}
            gradientUnits="userSpaceOnUse"
            x1={ring.gradient.x1}
            y1={ring.gradient.y1}
            x2={ring.gradient.x2}
            y2={ring.gradient.y2}
          >
            {ring.gradient.stops.map((color, index) => (
              <Stop key={color} offset={GRADIENT_OFFSETS[index] ?? 1} stopColor={color} />
            ))}
          </LinearGradient>
        ))}
      </Defs>
      {rings.map((ring, index) => (
        <OrbitArcPath
          key={ring.id}
          clock={clock}
          gradientId={`${id}-${ring.id}`}
          index={index}
          layer={layer}
          ring={ring}
        />
      ))}
    </Svg>
  );
}

/**
 * The desktop's orbit rings around a working agent. The half of each ring behind the body draws
 * under the avatar and the other half over it. With reduced motion, or with the Settings switch for
 * faces off, the rings hold still, as on the desktop. They stop while the screen is not focused or
 * the app is in the background.
 */
export function AgentOrbitRings({ active, size, children }: PropsWithChildren<{ active: boolean; size: number }>) {
  const clock = useSharedValue(0);
  const animate = useMotionPreference("agentFaces");
  const focused = useScreenFocusedWhile(active && animate);
  const foreground = useAppForeground();
  useEffect(() => {
    if (active) prepareOrbitFrames();
  }, [active]);
  useEffect(() => {
    clock.set(0);
    if (!active || !animate || !focused || !foreground) return;
    clock.set(
      withRepeat(
        withTiming(ORBIT_CYCLE, {
          duration: ORBIT_CYCLE * 1000,
          easing: Easing.linear,
          reduceMotion: ReduceMotion.Never,
        }),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(clock);
  }, [active, animate, clock, focused, foreground]);
  return (
    <View style={{ width: size, height: size }}>
      {active ? <OrbitLayer clock={clock} layer="back" size={size} /> : null}
      {children}
      {active ? <OrbitLayer clock={clock} layer="front" size={size} /> : null}
    </View>
  );
}
