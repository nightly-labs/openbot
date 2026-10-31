import type { PlanLimitRow, PlanLimitTone } from "@openbot/team-client/plan-limits";
import { useThemeColor } from "heroui-native/hooks";
import { useId } from "react";
import { View } from "react-native";
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
              const circumference = 2 * Math.PI * radius;
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
                  <Circle
                    cx={center}
                    cy={center}
                    r={radius}
                    stroke={tones[window.tone]}
                    strokeWidth={stroke}
                    strokeDasharray={`${(circumference * window.remainingPercent) / 100} ${circumference}`}
                    fill="none"
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
