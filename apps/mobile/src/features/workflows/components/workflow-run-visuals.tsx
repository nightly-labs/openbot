import type { WorkflowStep } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import CircleCheck from "lucide-react-native/icons/circle-check";
import CircleX from "lucide-react-native/icons/circle-x";
import LoaderCircle from "lucide-react-native/icons/loader-circle";
import UserRoundCheck from "lucide-react-native/icons/user-round-check";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Line, Rect } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { formatRunDuration } from "@/features/workflows/model/workflow-duration";
import { stepStatusLabel } from "@/features/workflows/model/workflow-steps";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SWEEP_MS = 1600;
const ARC_SHARE = 0.28;
const STROKE = 1.5;
const DASH = 5;
const MARCH_MS = 1200;
const COMET_MS = 1100;
const COMET_EASE = Easing.bezier(0.23, 1, 0.32, 1);
const RUN_CONNECTOR_WIDTH = 28;
const CONNECTOR_HEIGHT = 6;

export function RunningRing({ width, height, radius }: { width: number; height: number; radius: number }) {
  const reduced = useReducedMotion();
  const text = String(useCSSVariable("--openbot-text-primary"));
  const w = width - STROKE;
  const h = height - STROKE;
  const r = Math.max(0, radius - STROKE / 2);
  const perimeter = 2 * (w + h) - (8 - 2 * Math.PI) * r;
  const offset = useSharedValue(0);
  useEffect(() => {
    offset.set(0);
    if (!reduced) offset.set(withRepeat(withTiming(-perimeter, { duration: SWEEP_MS, easing: Easing.linear }), -1));
    return () => cancelAnimation(offset);
  }, [offset, perimeter, reduced]);
  const arc = useAnimatedProps(() => ({ strokeDashoffset: offset.get() }));
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={height}>
      <Rect
        x={STROKE / 2}
        y={STROKE / 2}
        width={w}
        height={h}
        rx={r}
        fill="none"
        stroke={text}
        strokeOpacity={reduced ? 0.56 : 0.16}
        strokeWidth={STROKE}
      />
      {reduced ? null : (
        <AnimatedRect
          x={STROKE / 2}
          y={STROKE / 2}
          width={w}
          height={h}
          rx={r}
          fill="none"
          stroke={text}
          strokeOpacity={0.9}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${perimeter * ARC_SHARE} ${perimeter}`}
          animatedProps={arc}
        />
      )}
    </Svg>
  );
}

export type RunTone = "idle" | "run" | "done";

export function RunConnector({ tone }: { tone: RunTone }) {
  const reduced = useReducedMotion();
  const text = String(useCSSVariable("--openbot-text-primary"));
  const moving = tone === "run" && !reduced;
  const march = useSharedValue(0);
  const comet = useSharedValue(0);
  useEffect(() => {
    march.set(0);
    comet.set(0);
    if (moving) {
      march.set(withRepeat(withTiming(-2 * DASH, { duration: MARCH_MS, easing: Easing.linear }), -1));
      comet.set(withRepeat(withTiming(1, { duration: COMET_MS, easing: COMET_EASE }), -1));
    }
    return () => {
      cancelAnimation(march);
      cancelAnimation(comet);
    };
  }, [comet, march, moving]);
  const dashes = useAnimatedProps(() => ({ strokeDashoffset: march.get() }));
  const dot = useAnimatedProps(() => ({ cx: 2 + comet.get() * (RUN_CONNECTOR_WIDTH - 4) }));
  const y = CONNECTOR_HEIGHT / 2;
  return (
    <Svg width={RUN_CONNECTOR_WIDTH} height={CONNECTOR_HEIGHT} style={{ alignSelf: "center" }}>
      <AnimatedLine
        x1={0}
        y1={y}
        x2={RUN_CONNECTOR_WIDTH}
        y2={y}
        stroke={text}
        strokeOpacity={tone === "run" ? 0.72 : tone === "done" ? 0.6 : 0.32}
        strokeWidth={STROKE}
        strokeDasharray={tone === "done" ? undefined : `${DASH} ${DASH}`}
        animatedProps={dashes}
      />
      {moving ? <AnimatedCircle cy={y} r={2} fill={text} animatedProps={dot} /> : null}
    </Svg>
  );
}

const SPIN = { from: { transform: [{ rotate: "0deg" }] }, to: { transform: [{ rotate: "360deg" }] } };

function Spinner({ color }: { color: string }) {
  const reduced = useReducedMotion();
  return (
    <Animated.View
      style={
        reduced
          ? undefined
          : {
              animationName: SPIN,
              animationDuration: 1000,
              animationIterationCount: "infinite",
              animationTimingFunction: "linear",
            }
      }
    >
      <LoaderCircle color={color} size={13} strokeWidth={2.2} />
    </Animated.View>
  );
}

function useElapsed(startedAt: string | null): string | null {
  const { t } = useText();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt ? formatRunDuration(startedAt, new Date(now).toISOString(), t) : null;
}

export function RunStepStatus({ step }: { step: WorkflowStep | undefined }) {
  const { t } = useText();
  const [secondary, warning, success, danger] = useCSSVariable([
    "--openbot-text-secondary",
    "--openbot-warning-text",
    "--openbot-success-text",
    "--openbot-danger-text",
  ]);
  const status = step?.status;
  const elapsed = useElapsed(status === "running" ? (step?.startedAt ?? null) : null);
  const took = step?.startedAt && step.endedAt ? formatRunDuration(step.startedAt, step.endedAt, t) : null;
  const label = step ? t(stepStatusLabel(step)) : t("mobile.workflow.status.notRun");
  const icon =
    status === "running" ? (
      <Spinner color={String(secondary)} />
    ) : status === "approval" ? (
      <UserRoundCheck color={String(warning)} size={13} strokeWidth={2.2} />
    ) : status === "done" ? (
      <CircleCheck color={String(success)} size={13} strokeWidth={2.2} />
    ) : status === "failed" ? (
      <CircleX color={String(danger)} size={13} strokeWidth={2.2} />
    ) : null;
  const tone =
    status === "approval"
      ? "text-warning-text"
      : status === "done"
        ? "text-success-text"
        : status === "failed"
          ? "text-danger-text"
          : "text-grouped-secondary";
  return (
    <View className="flex-row items-center gap-1">
      {icon}
      <Typography.Paragraph
        className={`font-medium ${tone}`}
        numberOfLines={1}
        style={[typeScale.small, { fontVariant: ["tabular-nums"] }]}
      >
        {status === "running" ? (elapsed ?? label) : status === "done" ? (took ?? label) : label}
      </Typography.Paragraph>
    </View>
  );
}
