import type { PlanLimitRow, PlanLimitTone } from "@openbot/team-client/plan-limits";
import { useThemeColor } from "heroui-native/hooks";
import { useEffect, useId } from "react";
import { View } from "react-native";
import Animated, { Easing, ReduceMotion, useAnimatedProps, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle, Defs, G, Mask, Rect } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { ProviderMark } from "@/features/servers/components/provider-mark";
import { planLimitWindowKey } from "@/features/servers/model/plan-limits";

/** The desktop rail ring, scaled from its 34 pt: the stroke and the space between rings. */
const STROKE_RATIO = 2.25 / 34;
const SPACING_RATIO = 4.5 / 34;
const LOGO_RATIO = 12 / 34;

/** The text colour of a window's amount left, in the tone of its ring. */
export const PLAN_LIMIT_TONE_TEXT = {
  neutral: "",
  warning: "text-warning-text",
  critical: "text-danger-text",
} as const satisfies Record<PlanLimitTone, string>;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** How long an arc takes to move to a new reading. */
const FILL_DURATION_MS = 600;

/**
 * The arc of what is left of one window. A new reading moves the arc from its last value; the first
 * reading draws it at once, so the header does not animate each time it shows.
 */
function RingArc({
  center,
  radius,
  stroke,
  color,
  remainingPercent,
}: {
  center: number;
  radius: number;
  stroke: number;
  color: string;
  remainingPercent: number;
}) {
  const circumference = 2 * Math.PI * radius;
  const remaining = useSharedValue(remainingPercent);
  useEffect(() => {
    remaining.set(
      withTiming(remainingPercent, { duration: FILL_DURATION_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.System }),
    );
  }, [remaining, remainingPercent]);
  const props = useAnimatedProps(() => ({
    strokeDashoffset: (circumference * (100 - remaining.get())) / 100,
  }));
  return (
    <AnimatedCircle
      cx={center}
      cy={center}
      r={radius}
      stroke={color}
      strokeWidth={stroke}
      strokeDasharray={`${circumference} ${circumference}`}
      fill="none"
      animatedProps={props}
    />
  );
}

function useToneColors(): Record<PlanLimitTone, string> {
  const [success, warning, danger] = useCSSVariable(["--openbot-success", "--openbot-warning", "--openbot-danger"]);
  return { neutral: String(success), warning: String(warning), critical: String(danger) };
}

/**
 * The limits of one provider account as concentric rings, as on the desktop rail: the outer ring is
 * the longest window, the inner ring the shortest. Each arc shows how much is left, in the tone of that
 * window. The provider mark is in the middle. It is an image: the button that holds it has the label.
 * A `cutout` clears a circle of the rings, where another ring lies over this one, on any background.
 */
export function PlanLimitRing({
  row,
  size,
  cutout,
}: {
  row: PlanLimitRow;
  size: number;
  cutout?: { cx: number; cy: number; r: number } | undefined;
}) {
  const maskId = `plan-limit-cutout-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const tones = useToneColors();
  const track = String(useThemeColor("foreground"));
  const stroke = size * STROKE_RATIO;
  const spacing = size * SPACING_RATIO;
  const outer = (size - stroke) / 2;
  const center = size / 2;
  const windows = [...row.windows].reverse();
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        {cutout ? (
          <Defs>
            <Mask id={maskId} x={0} y={0} width={size} height={size} maskUnits="userSpaceOnUse">
              <Rect x={0} y={0} width={size} height={size} fill="white" />
              <Circle cx={cutout.cx} cy={cutout.cy} r={cutout.r} fill="black" />
            </Mask>
          </Defs>
        ) : null}
        <G mask={cutout ? `url(#${maskId})` : undefined}>
          <G rotation={-90} origin={`${center}, ${center}`}>
            {windows.map((window, index) => {
              const radius = outer - index * spacing;
              return (
                <G key={planLimitWindowKey(window, index)}>
                  <Circle
                    cx={center}
                    cy={center}
                    r={radius}
                    stroke={track}
                    strokeOpacity={0.15}
                    strokeWidth={stroke}
                    fill="none"
                  />
                  <RingArc
                    center={center}
                    radius={radius}
                    stroke={stroke}
                    color={tones[window.tone]}
                    remainingPercent={window.remainingPercent}
                  />
                </G>
              );
            })}
          </G>
        </G>
      </Svg>
      <ProviderMark provider={row.provider} size={Math.round(size * LOGO_RATIO)} />
    </View>
  );
}
