import { memo, useEffect } from "react";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, G } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import type { ContextMeterLevel } from "@/features/chat/model/context-usage";
import { useReducedMotion } from "@/shared/lib/motion";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Drawn at the size of the attachment menu's other icons.
const SIZE = 21;
const STROKE = 2.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// While the host compacts, a fixed arc turns, as on the desktop: the fill means nothing until it ends.
const COMPACTING_SHARE = 0.28;
const SPIN_MS = 900;
// A new reading eases to its value instead of jumping. Strong ease-out: it answers a turn that just ended.
const FILL_MS = 300;
const FILL_EASING = Easing.bezier(0.23, 1, 0.32, 1);

/** What the context ring shows, and what a press on its row in the attachment menu does. */
export interface ComposerContextMeter {
  /** The used share of the window, 0 to 1. */
  share: number;
  level: ContextMeterLevel;
  compacting: boolean;
  /** "Context 42% full", for a screen reader. */
  label: string;
  onPress: () => void;
}

/**
 * How full the chat's context is, as the ring of the desktop composer. It is the icon of the Context
 * row in the attachment menu, and the row owns the press. The fill and the turn of a compaction run
 * on the UI thread: a new reading sets their target, and React draws nothing per frame.
 */
export const ComposerContextRing = memo(function ComposerContextRing({ meter }: { meter: ComposerContextMeter }) {
  const [dim, secondary, warning, danger, accent] = useCSSVariable([
    "--openbot-text-dim",
    "--openbot-text-secondary",
    "--openbot-warning",
    "--openbot-danger",
    "--openbot-accent",
  ]);
  const reducedMotion = useReducedMotion();
  const color = meter.compacting
    ? accent
    : meter.level === "warning"
      ? warning
      : meter.level === "danger"
        ? danger
        : meter.level === "quiet"
          ? dim
          : secondary;
  const target = meter.compacting ? COMPACTING_SHARE : meter.share;
  const fill = useSharedValue(target);
  useEffect(() => {
    fill.set(
      withTiming(target, {
        duration: reducedMotion ? 0 : FILL_MS,
        easing: FILL_EASING,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [fill, target, reducedMotion]);
  const turn = useSharedValue(0);
  useEffect(() => {
    if (!meter.compacting || reducedMotion) {
      cancelAnimation(turn);
      turn.set(0);
      return;
    }
    turn.set(0);
    turn.set(withRepeat(withTiming(1, { duration: SPIN_MS, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(turn);
  }, [meter.compacting, reducedMotion, turn]);
  const arcProps = useAnimatedProps(() => ({ strokeDashoffset: CIRCUMFERENCE * (1 - fill.get()) }));
  const turnStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 360}deg` }] }));
  return (
    <Animated.View style={[{ width: SIZE, height: SIZE }, turnStyle]}>
      <Svg width={SIZE} height={SIZE}>
        <G rotation={-90} origin={`${SIZE / 2}, ${SIZE / 2}`}>
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            // The track of the desktop meter: the dim text colour, faint.
            stroke={String(dim)}
            strokeOpacity={0.35}
            strokeWidth={STROKE}
            fill="none"
          />
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={String(color)}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            fill="none"
            animatedProps={arcProps}
          />
        </G>
      </Svg>
    </Animated.View>
  );
});
