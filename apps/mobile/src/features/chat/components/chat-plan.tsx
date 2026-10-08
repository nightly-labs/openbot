import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import { ChevronDown } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  cancelAnimation,
  cubicBezier,
  Easing,
  interpolate,
  Keyframe,
  LayoutAnimationConfig,
  ReduceMotion,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import type { ChatMessage, ChatPlanStepState } from "@/features/chat/model/chat-messages";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";
import { ThinkingTextGradient } from "./thinking-text-gradient";

type PlanMessage = Extract<ChatMessage, { kind: "plan" }>;

/** The glyph size and ring of the desktop task list (`TaskList.tsx`), so both read the same. */
const GLYPH = 16;
const RING_RADIUS = 7.25;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * The motion of the desktop task list (`task-list.css`). The open is slower than the close: rows
 * settle in one after another, and leave together. The stagger stops after the eighth row.
 */
const OPEN_MS = 320;
const CLOSE_MS = 200;
const STAGGER_MS = 28;
const STAGGER_ROWS = 8;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const EASE_CLOSE = Easing.bezier(0.32, 0.08, 0.24, 1);
const TITLE_ENTER = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 4 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: EASE_OUT },
})
  .duration(OPEN_MS)
  .reduceMotion(ReduceMotion.System);

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const STATE_LABELS = {
  pending: "mobile.chat.plan.state.pending",
  active: "mobile.chat.plan.state.active",
  done: "mobile.chat.plan.state.done",
} as const satisfies Record<ChatPlanStepState, MobileTextKey>;

interface PlanColors {
  primary: string;
  muted: string;
  dim: string;
  border: string;
  track: string;
  canvas: string;
}

function usePlanColors(): PlanColors {
  const [primary, muted, dim, border, track, canvas] = useCSSVariable([
    "--openbot-text-primary",
    "--openbot-text-muted",
    "--openbot-text-dim",
    "--openbot-border",
    "--openbot-border-strong",
    "--openbot-bg-native-canvas",
  ]);
  return {
    primary: String(primary),
    muted: String(muted),
    dim: String(dim),
    border: String(border),
    track: String(track),
    canvas: String(canvas),
  };
}

function SpinningArc({ colors }: { colors: PlanColors }) {
  const turn = useSharedValue(0);
  useEffect(() => {
    turn.set(
      withRepeat(withTiming(1, { duration: 900, easing: Easing.linear, reduceMotion: ReduceMotion.System }), -1, false),
    );
    return () => cancelAnimation(turn);
  }, [turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 360}deg` }] }));
  return (
    <Animated.View style={[{ width: GLYPH, height: GLYPH }, style]}>
      <Svg width={GLYPH} height={GLYPH} viewBox="0 0 16 16" fill="none">
        <Circle cx={8} cy={8} r={RING_RADIUS} stroke={colors.track} strokeWidth={1.5} />
        <Circle
          cx={8}
          cy={8}
          r={RING_RADIUS}
          stroke={colors.primary}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeDasharray="12 100"
        />
      </Svg>
    </Animated.View>
  );
}

function DoneMark({ colors }: { colors: PlanColors }) {
  return (
    <Svg width={GLYPH} height={GLYPH} viewBox="0 0 16 16" fill="none">
      <Circle cx={8} cy={8} r={8} fill={colors.dim} />
      <Path
        d="M4.8 8.4 7.04 10.8 11.52 6"
        stroke={colors.canvas}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** A dotted ring while pending, a turning arc while active, a disc with a check when done. */
function StepMark({ state, colors }: { state: ChatPlanStepState; colors: PlanColors }) {
  if (state === "active") return <SpinningArc colors={colors} />;
  if (state === "done") return <DoneMark colors={colors} />;
  return (
    <Svg width={GLYPH} height={GLYPH} viewBox="0 0 16 16" fill="none">
      <Circle cx={8} cy={8} r={RING_RADIUS} stroke={colors.dim} strokeWidth={1.5} strokeDasharray="1.2 2" />
    </Svg>
  );
}

/** The share of done steps as a ring, or the done mark when every step is done. */
function SummaryMark({ done, total, colors }: { done: number; total: number; colors: PlanColors }) {
  const share = done / Math.max(total, 1);
  const progress = useSharedValue(share);
  useEffect(() => {
    progress.set(withTiming(share, { duration: 200, easing: EASE_OUT, reduceMotion: ReduceMotion.System }));
  }, [progress, share]);
  const arc = useAnimatedProps(() => ({ strokeDashoffset: RING_LENGTH * (1 - progress.get()) }));
  if (total > 0 && done === total) return <DoneMark colors={colors} />;
  return (
    <Svg width={GLYPH} height={GLYPH} viewBox="0 0 16 16" fill="none">
      <Circle cx={8} cy={8} r={RING_RADIUS} stroke={colors.track} strokeWidth={1.5} />
      <AnimatedCircle
        cx={8}
        cy={8}
        r={RING_RADIUS}
        stroke={colors.primary}
        strokeWidth={1.5}
        strokeDasharray={`${RING_LENGTH}`}
        animatedProps={arc}
        transform="rotate(-90 8 8)"
      />
    </Svg>
  );
}

/** The mobile form of the desktop task list: a card whose header opens or closes the steps. */
/**
 * One step. Its entrance follows the panel: each row starts a little after the one above it while
 * the panel opens, and all rows leave together while it closes.
 */
function PlanStep({
  step,
  index,
  openness,
  opening,
  colors,
  label,
}: {
  step: PlanMessage["steps"][number];
  index: number;
  openness: SharedValue<number>;
  opening: SharedValue<boolean>;
  colors: PlanColors;
  label: string;
}) {
  const start = (Math.min(index, STAGGER_ROWS) * STAGGER_MS) / OPEN_MS;
  const style = useAnimatedStyle(() => {
    const value = openness.get();
    const shown = opening.get() ? interpolate(value, [start, 1], [0, 1], "clamp") : value;
    return {
      opacity: shown,
      transform: [{ translateY: -4 * (1 - shown) }, { scale: 0.98 + 0.02 * shown }],
    };
  });
  return (
    <Animated.View style={style} accessible accessibilityLabel={label} className="flex-row items-start gap-3">
      <View className="h-6 justify-center">
        <StepMark state={step.state} colors={colors} />
      </View>
      <View className="min-w-0 flex-1">
        {step.state === "active" ? (
          <ThinkingTextGradient text={step.text} type="body" enabled foreground={colors.primary} muted={colors.muted}>
            <Typography.Paragraph style={{ color: colors.primary }}>{step.text}</Typography.Paragraph>
          </ThinkingTextGradient>
        ) : (
          <Typography.Paragraph
            style={{
              color: step.state === "done" ? colors.dim : colors.muted,
              textDecorationLine: step.state === "done" ? "line-through" : "none",
            }}
          >
            {step.text}
          </Typography.Paragraph>
        )}
      </View>
    </Animated.View>
  );
}

/**
 * The mobile form of the desktop task list: a card whose header opens or closes the steps.
 *
 * The panel animates its real height, as the desktop grid row does, so the chat list lays out the
 * row on each frame and the messages below move with the card instead of jumping over it.
 */
export function ChatPlan({ message }: { message: PlanMessage }) {
  const { t } = useText();
  const colors = usePlanColors();
  const reducedMotion = useReducedMotion();
  const [open, setOpen] = useState(true);
  const openness = useSharedValue(1);
  const opening = useSharedValue(true);
  // -1 until the steps are measured: the panel keeps its natural height until then.
  const contentHeight = useSharedValue(-1);
  useEffect(() => {
    opening.set(open);
    openness.set(
      withTiming(open ? 1 : 0, {
        duration: open ? OPEN_MS : CLOSE_MS,
        easing: open ? EASE_OUT : EASE_CLOSE,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [open, opening, openness]);
  const panelStyle = useAnimatedStyle(() => {
    const height = contentHeight.get();
    return height < 0 ? {} : { height: height * openness.get() };
  });
  const total = message.steps.length;
  const done = message.steps.filter((step) => step.state === "done").length;
  const active = message.steps.find((step) => step.state === "active");
  const title = message.stopped ? t("mobile.chat.plan.stopped") : (message.heading ?? t("mobile.chat.plan.title"));
  // A closed list names the running step, so the work stays visible.
  const headerText = !open && active ? active.text : title;
  return (
    // The title that the card mounts with does not enter; a title that a toggle changes does.
    <LayoutAnimationConfig skipEntering>
      <View
        className="w-full self-stretch overflow-hidden rounded-[14px] border"
        style={{ borderColor: colors.border, backgroundColor: colors.canvas, borderCurve: "continuous" }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${title}, ${t("mobile.chat.plan.summary", { done, total })}`}
          onPress={() => {
            void haptics.selection();
            setOpen((value) => !value);
          }}
          className="flex-row items-center gap-3 p-3"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <SummaryMark done={done} total={total} colors={colors} />
          <Animated.View key={headerText} entering={TITLE_ENTER} className="min-w-0 flex-1">
            <Typography.Paragraph numberOfLines={1} style={{ color: colors.primary }}>
              {headerText}
            </Typography.Paragraph>
          </Animated.View>
          <Typography.Paragraph style={{ color: colors.muted, fontVariant: ["tabular-nums"] }}>
            {t("mobile.chat.plan.count", { done, total })}
          </Typography.Paragraph>
          <Animated.View
            style={{
              transform: [{ rotate: open ? "0deg" : "-90deg" }],
              transitionProperty: "transform",
              transitionDuration: reducedMotion ? 0 : 160,
              transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
            }}
          >
            <ChevronDown size={GLYPH} color={colors.muted} />
          </Animated.View>
        </Pressable>
        <Animated.View
          style={[{ overflow: "hidden" }, panelStyle]}
          pointerEvents={open ? "auto" : "none"}
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? "auto" : "no-hide-descendants"}
        >
          <View className="gap-1 px-3 pb-3" onLayout={(event) => contentHeight.set(event.nativeEvent.layout.height)}>
            {message.explanation ? (
              <Typography.Paragraph type="body-sm" style={{ color: colors.muted }}>
                {message.explanation}
              </Typography.Paragraph>
            ) : null}
            {message.steps.map((step, index) => (
              <PlanStep
                key={step.id}
                step={step}
                index={index}
                openness={openness}
                opening={opening}
                colors={colors}
                label={`${t(STATE_LABELS[step.state])}, ${step.text}`}
              />
            ))}
          </View>
        </Animated.View>
      </View>
    </LayoutAnimationConfig>
  );
}
