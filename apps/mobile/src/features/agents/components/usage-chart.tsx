import { Typography } from "heroui-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedProps,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import { useCSSVariable } from "uniwind";
import { haptics } from "@/shared/lib/haptics";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const HEIGHT = 160;
const HEADROOM = 8;
const AXIS_WIDTH = 52;
const MORPH_MS = 320;
const POINT_RADIUS = 3;
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

export interface UsageChartSeries {
  key: string;
  color: string;
  values: (number | null)[];
}

export function useUsageSeriesColor(): (provider: string) => string {
  const codex = String(useCSSVariable("--openbot-chart-series-codex"));
  const claude = String(useCSSVariable("--openbot-chart-series-claude"));
  const grok = String(useCSSVariable("--openbot-chart-series-grok"));
  const other = String(useCSSVariable("--openbot-chart-series-other"));
  return useCallback(
    (provider: string) => {
      const colors: Readonly<Record<string, string | undefined>> = { codex, claude, grok };
      return colors[provider] ?? other;
    },
    [codex, claude, grok, other],
  );
}

function scale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 1, ticks: [0] };
  const rough = max / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((factor) => factor * magnitude >= rough) ?? 10) * magnitude;
  return { top: step * 3, ticks: [0, step, step * 2, step * 3] };
}

function valueAt(values: readonly number[], index: number): number {
  "worklet";
  return values[index] ?? Number.NaN;
}

function between(start: number, target: number, progress: number): number {
  "worklet";
  return Number.isNaN(target) || Number.isNaN(start) ? target : start + (target - start) * progress;
}

function resample(values: number[], count: number): number[] {
  if (values.length === 0) return new Array<number>(count).fill(HEIGHT);
  return Array.from({ length: count }, (_, index) => {
    const position = count === 1 ? 0 : (index / (count - 1)) * (values.length - 1);
    const low = valueAt(values, Math.floor(position));
    const high = valueAt(values, Math.ceil(position));
    if (Number.isNaN(low)) return high;
    if (Number.isNaN(high)) return low;
    return low + (high - low) * (position - Math.floor(position));
  });
}

function shownValues(from: number[], to: number[], progress: number): number[] {
  return to.map((target, index) => between(valueAt(from, index), target, progress));
}

function seriesPaths(
  from: number[],
  to: number[],
  progress: number,
  width: number,
): { line: string; area: string; points: string } {
  "worklet";
  const count = to.length;
  const ys: number[] = [];
  for (let index = 0; index < count; index++) ys.push(between(valueAt(from, index), valueAt(to, index), progress));
  const x = (index: number) => (count === 1 ? width / 2 : (index / (count - 1)) * width);
  const y = (index: number) => valueAt(ys, index);
  let line = "";
  let area = "";
  let points = "";
  let index = 0;
  while (index < count) {
    if (Number.isNaN(y(index))) {
      index++;
      continue;
    }
    let end = index;
    while (end + 1 < count && !Number.isNaN(y(end + 1))) end++;
    if (end === index) {
      const cx = x(index);
      const cy = y(index);
      points += `M${(cx - POINT_RADIUS).toFixed(1)} ${cy.toFixed(1)}a${POINT_RADIUS} ${POINT_RADIUS} 0 1 0 ${POINT_RADIUS * 2} 0a${POINT_RADIUS} ${POINT_RADIUS} 0 1 0 ${-POINT_RADIUS * 2} 0Z`;
      index++;
      continue;
    }
    const slopes: number[] = [];
    for (let point = index; point < end; point++) slopes.push((y(point + 1) - y(point)) / (x(point + 1) - x(point)));
    const tangents: number[] = [];
    for (let point = index; point <= end; point++) {
      const before = slopes[point - index - 1];
      const after = slopes[point - index];
      if (before === undefined) tangents.push(after ?? 0);
      else if (after === undefined) tangents.push(before);
      else tangents.push(before * after <= 0 ? 0 : (before + after) / 2);
    }
    for (let segment = 0; segment < slopes.length; segment++) {
      const slope = slopes[segment] ?? 0;
      if (slope === 0) {
        tangents[segment] = 0;
        tangents[segment + 1] = 0;
        continue;
      }
      const a = (tangents[segment] ?? 0) / slope;
      const b = (tangents[segment + 1] ?? 0) / slope;
      const sum = a * a + b * b;
      if (sum > 9) {
        const tau = 3 / Math.sqrt(sum);
        tangents[segment] = tau * a * slope;
        tangents[segment + 1] = tau * b * slope;
      }
    }
    let run = `M${x(index).toFixed(1)} ${y(index).toFixed(1)}`;
    for (let point = index; point < end; point++) {
      const third = (x(point + 1) - x(point)) / 3;
      const t0 = tangents[point - index] ?? 0;
      const t1 = tangents[point - index + 1] ?? 0;
      run += `C${(x(point) + third).toFixed(1)} ${(y(point) + t0 * third).toFixed(1)} ${(x(point + 1) - third).toFixed(1)} ${(y(point + 1) - t1 * third).toFixed(1)} ${x(point + 1).toFixed(1)} ${y(point + 1).toFixed(1)}`;
    }
    line += run;
    area += `${run}L${x(end).toFixed(1)} ${HEIGHT}L${x(index).toFixed(1)} ${HEIGHT}Z`;
    index = end + 1;
  }
  return { line, area, points };
}

function SeriesArea({ ys, width, color, enter }: { ys: number[]; width: number; color: string; enter: boolean }) {
  const baseline = ys.map((y) => (Number.isNaN(y) ? y : HEIGHT));
  const from = useSharedValue(enter ? baseline : ys);
  const to = useSharedValue(ys);
  const progress = useSharedValue(enter ? 0 : 1);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) {
      from.set(resample(shownValues(from.get(), to.get(), progress.get()), ys.length));
      to.set(ys);
      progress.set(0);
    }
    mounted.current = true;
    if (progress.get() < 1)
      progress.set(withTiming(1, { duration: MORPH_MS, easing: EASE_IN_OUT, reduceMotion: ReduceMotion.System }));
  }, [ys, from, to, progress]);
  const paths = useDerivedValue(() => seriesPaths(from.get(), to.get(), progress.get(), width));
  const areaProps = useAnimatedProps(() => ({ d: paths.get().area }));
  const lineProps = useAnimatedProps(() => ({ d: paths.get().line }));
  const pointProps = useAnimatedProps(() => ({ d: paths.get().points }));
  return (
    <>
      <AnimatedPath animatedProps={areaProps} fill={color} fillOpacity={0.12} />
      <AnimatedPath
        animatedProps={lineProps}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <AnimatedPath animatedProps={pointProps} fill={color} />
    </>
  );
}

export function UsageChart({
  dates,
  series,
  formatValue,
  formatDate,
  selected,
  onSelect,
  label,
  value,
}: {
  dates: string[];
  series: UsageChartSeries[];
  formatValue: (value: number) => string;
  formatDate: (date: string) => string;
  selected: number | null;
  onSelect: (index: number | null) => void;
  label: string;
  value: string;
}) {
  const gridColor = String(useCSSVariable("--openbot-border-strong"));
  const mutedColor = String(useCSSVariable("--openbot-text-muted"));
  const [width, setWidth] = useState(0);
  const plotWidth = Math.max(0, width - AXIS_WIDTH);
  const max = Math.max(0, ...series.flatMap((item) => item.values.map((day) => day ?? 0)));
  const { top, ticks } = scale(max);
  const y = (amount: number) => HEADROOM + (1 - amount / top) * (HEIGHT - HEADROOM);
  const pixels = useMemo(
    () =>
      series.map((item) => ({
        ...item,
        ys: item.values.map((day) => (day === null ? Number.NaN : HEADROOM + (1 - day / top) * (HEIGHT - HEADROOM))),
      })),
    [series, top],
  );
  const drawn = useRef(false);
  useEffect(() => {
    if (plotWidth > 0) drawn.current = true;
  }, [plotWidth]);

  const count = useSharedValue(dates.length);
  const plot = useSharedValue(plotWidth);
  const last = useSharedValue(selected ?? -1);
  useEffect(() => {
    count.set(dates.length);
    plot.set(plotWidth);
    last.set(selected ?? -1);
  }, [dates.length, plotWidth, selected, count, plot, last]);
  const gesture = useMemo(() => {
    const select = (index: number) => onSelect(index);
    const toggle = (index: number) => {
      void haptics.selection();
      onSelect(index === selected ? null : index);
    };
    const startScrub = () => void haptics.selection();
    const pick = (x: number) => {
      "worklet";
      const days = count.get();
      const widthValue = plot.get();
      if (days === 0 || widthValue <= 0) return -1;
      const index = days === 1 ? 0 : Math.round((x / widthValue) * (days - 1));
      return Math.min(days - 1, Math.max(0, index));
    };
    const pan = Gesture.Pan()
      .activeOffsetX([-6, 6])
      .failOffsetY([-12, 12])
      .onStart(() => {
        scheduleOnRN(startScrub);
      })
      .onUpdate((event) => {
        const index = pick(event.x);
        if (index < 0 || index === last.get()) return;
        last.set(index);
        scheduleOnRN(select, index);
      });
    const tap = Gesture.Tap().onEnd((event) => {
      const index = pick(event.x);
      if (index >= 0) scheduleOnRN(toggle, index);
    });
    return Gesture.Race(pan, tap);
  }, [onSelect, selected, count, plot, last]);

  const cursor = selected !== null && selected < dates.length ? selected : null;
  const cursorX = cursor === null ? 0 : dates.length === 1 ? plotWidth / 2 : (cursor / (dates.length - 1)) * plotWidth;
  const middle = dates.length >= 3 ? Math.floor((dates.length - 1) / 2) : -1;
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: value }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        if (!dates.length) return;
        const step = event.nativeEvent.actionName === "increment" ? 1 : -1;
        const start = cursor ?? (step > 0 ? -1 : dates.length);
        onSelect(Math.min(dates.length - 1, Math.max(0, start + step)));
      }}
      className="gap-2"
      style={{ direction: "ltr" }}
    >
      <GestureDetector gesture={gesture}>
        <View style={{ height: HEIGHT }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          {plotWidth > 0 ? (
            <Svg width={plotWidth} height={HEIGHT} style={{ overflow: "visible" }}>
              {ticks.map((tick) => (
                <Line key={tick} x1={0} x2={plotWidth} y1={y(tick)} y2={y(tick)} stroke={gridColor} strokeWidth={1} />
              ))}
              {pixels.map((item) => (
                <SeriesArea key={item.key} ys={item.ys} width={plotWidth} color={item.color} enter={drawn.current} />
              ))}
              {cursor !== null ? (
                <>
                  <Line x1={cursorX} x2={cursorX} y1={0} y2={HEIGHT} stroke={mutedColor} strokeWidth={1} />
                  {pixels.map((item) => {
                    const cy = valueAt(item.ys, cursor);
                    return Number.isNaN(cy) ? null : (
                      <Circle key={item.key} cx={cursorX} cy={cy} r={4} fill={item.color} />
                    );
                  })}
                </>
              ) : null}
            </Svg>
          ) : null}
          {ticks.map((tick) => (
            <Typography
              key={tick}
              type="body-xs"
              numberOfLines={1}
              className="absolute right-0 text-grouped-secondary"
              style={{ top: y(tick) - 8, width: AXIS_WIDTH - 6, textAlign: "right" }}
            >
              {formatValue(tick)}
            </Typography>
          ))}
        </View>
      </GestureDetector>
      <View className="flex-row justify-between" style={{ marginRight: AXIS_WIDTH }}>
        {[...new Set([dates[0], dates[middle], dates.at(-1)])].map((date) =>
          date === undefined ? null : (
            <Typography key={date} type="body-xs" className="text-grouped-secondary">
              {formatDate(date)}
            </Typography>
          ),
        )}
      </View>
    </View>
  );
}
