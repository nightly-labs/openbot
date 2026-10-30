import { Typography } from "heroui-native";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle, G } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { useReducedMotion } from "@/shared/lib/motion";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const STROKE = 16;
/** A selected segment is this much wider, half outside the ring and half inside. */
const SELECTED_GROWTH = 6;
const SIZE = 176 + SELECTED_GROWTH;
const RADIUS = (SIZE - STROKE - SELECTED_GROWTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** The space between two segments, along the ring. */
const GAP = 3;
/** A small share still shows as a short arc. */
const MIN_ARC = 2;
const REVEAL_MS = 700;
const SELECT_MS = 200;
/** The opacity of the other segments while one is selected. */
const DIMMED = 0.25;

export interface StorageRingSegment {
  key: string;
  color: string;
  bytes: number;
}

/**
 * The share of each storage type as one ring, like the stacked bar of the desktop Storage page.
 * The ring is an image with a text summary; the legend rows below it carry the names and sizes.
 * A selected segment is wider and the others dim, so a legend row shows its part of the ring.
 */
export function StorageRing({
  segments,
  selected,
  value,
  caption,
  label,
}: {
  segments: readonly StorageRingSegment[];
  /** The key of the highlighted segment. Null shows every segment the same. */
  selected: string | null;
  /** The total, or the size of the selected segment, in the middle of the ring. */
  value: string;
  caption: string;
  /** The text summary that a screen reader reads in place of the ring. */
  label: string;
}) {
  const background = String(useCSSVariable("--openbot-bg-grouped"));
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    progress.set(reducedMotion ? 1 : withTiming(1, { duration: REVEAL_MS, easing: Easing.out(Easing.cubic) }));
  }, [progress, reducedMotion]);
  // A cover in the section color hides the ring after `progress`, so the ring fills clockwise.
  const cover = useAnimatedProps(() => ({ strokeDashoffset: -CIRCUMFERENCE * progress.get() }));
  const total = segments.reduce((sum, segment) => sum + segment.bytes, 0);
  const gap = segments.length > 1 ? GAP : 0;
  let start = 0;
  const arcs = segments.map((segment) => {
    const share = total > 0 ? segment.bytes / total : 0;
    const arc = { ...segment, start, length: Math.max(MIN_ARC, share * CIRCUMFERENCE - gap) };
    start += share * CIRCUMFERENCE;
    return arc;
  });
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      className="items-center justify-center self-center py-5"
    >
      <Svg width={SIZE} height={SIZE}>
        <G rotation={-90} origin={`${SIZE / 2}, ${SIZE / 2}`}>
          {arcs.map((arc) => (
            <Arc
              key={arc.key}
              color={arc.color}
              start={arc.start}
              length={arc.length}
              state={selected === null ? "normal" : selected === arc.key ? "selected" : "dimmed"}
              animate={!reducedMotion}
            />
          ))}
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={background}
            strokeWidth={STROKE + SELECTED_GROWTH + 2}
            strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            fill="none"
            animatedProps={cover}
          />
        </G>
      </Svg>
      <View className="absolute inset-0 items-center justify-center px-8">
        <Typography.Heading type="h4" numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Typography.Heading>
        <Typography.Paragraph type="body-xs" numberOfLines={1} className="text-grouped-secondary">
          {caption}
        </Typography.Paragraph>
      </View>
    </View>
  );
}

function Arc({
  color,
  start,
  length,
  state,
  animate,
}: {
  color: string;
  start: number;
  length: number;
  state: "normal" | "selected" | "dimmed";
  animate: boolean;
}) {
  const opacity = useSharedValue(1);
  const width = useSharedValue(STROKE);
  useEffect(() => {
    const timing = (to: number) => (animate ? withTiming(to, { duration: SELECT_MS }) : to);
    opacity.set(timing(state === "dimmed" ? DIMMED : 1));
    width.set(timing(state === "selected" ? STROKE + SELECTED_GROWTH : STROKE));
  }, [animate, opacity, state, width]);
  const animatedProps = useAnimatedProps(() => ({ strokeOpacity: opacity.get(), strokeWidth: width.get() }));
  return (
    <AnimatedCircle
      cx={SIZE / 2}
      cy={SIZE / 2}
      r={RADIUS}
      stroke={color}
      strokeDasharray={`0 ${start} ${length} ${CIRCUMFERENCE}`}
      fill="none"
      animatedProps={animatedProps}
    />
  );
}
