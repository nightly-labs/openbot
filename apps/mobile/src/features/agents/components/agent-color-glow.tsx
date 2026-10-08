import { useEffect, useId } from "react";
import { useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  type SharedValue,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, Mask, RadialGradient, Rect, Stop } from "react-native-svg";

// A strong ease-out: most of the change lands at once, and the tail lets a large tint settle
// rather than flash.
const COLOR_EASING = Easing.bezier(0.23, 1, 0.32, 1);
const COLOR_DURATION_MS = 400;
const GLOW_MAX_WIDTH = 460;
const GLOW_OPACITY = 0.38;

const AnimatedRect = Animated.createAnimatedComponent(Rect);

/**
 * The agent colour, eased on the UI runtime when it changes. Reduced motion keeps the fade: it
 * moves nothing, and it shows which colour replaced which.
 */
export function useAgentColorTransition(color: string): SharedValue<string> {
  const animated = useSharedValue(color);
  useEffect(() => {
    animated.set(
      withTiming(color, { duration: COLOR_DURATION_MS, easing: COLOR_EASING, reduceMotion: ReduceMotion.Never }),
    );
  }, [animated, color]);
  return animated;
}

/**
 * A soft glow in the agent colour, centred `centerY` points below the top of its parent. It fades to
 * nothing inside its box, so a clipping edge never cuts it.
 *
 * The colour is a fill under a fixed radial mask, so only the fill animates and the gradient is never
 * rebuilt. Decorative: it has no meaning for assistive technology.
 */
export function AgentColorGlow({
  color,
  centerY,
  height,
}: {
  color: SharedValue<string>;
  centerY: number;
  height: number;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.min(windowWidth * 1.1, GLOW_MAX_WIDTH);
  const id = useId().replaceAll(":", "");
  const fillProps = useAnimatedProps(() => ({ fill: color.get() }));
  return (
    <Svg
      accessibilityElementsHidden
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      width={width}
      height={height}
      style={{ position: "absolute", top: centerY - height / 2, left: "50%", transform: [{ translateX: -width / 2 }] }}
    >
      <Defs>
        <RadialGradient id={`${id}-falloff`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={1} />
          <Stop offset="0.35" stopColor="#ffffff" stopOpacity={0.6} />
          <Stop offset="0.7" stopColor="#ffffff" stopOpacity={0.16} />
          <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </RadialGradient>
        <Mask id={`${id}-mask`} x={0} y={0} width={width} height={height} maskUnits="userSpaceOnUse">
          <Rect width={width} height={height} fill={`url(#${id}-falloff)`} />
        </Mask>
      </Defs>
      <AnimatedRect
        width={width}
        height={height}
        mask={`url(#${id}-mask)`}
        opacity={GLOW_OPACITY}
        animatedProps={fillProps}
      />
    </Svg>
  );
}
