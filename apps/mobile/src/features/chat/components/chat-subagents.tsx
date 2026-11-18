import type { ConversationSubagent, ConversationSubagentStatus } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleCheck from "lucide-react-native/icons/circle-check";
import CircleX from "lucide-react-native/icons/circle-x";
import GitFork from "lucide-react-native/icons/git-fork";
import LoaderCircle from "lucide-react-native/icons/loader-circle";
import Minus from "lucide-react-native/icons/minus";
import X from "lucide-react-native/icons/x";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useCSSVariable } from "uniwind";
import type { ChatMessage } from "@/features/chat/model/chat-messages";
import {
  SUBAGENT_STATE_LABELS,
  subagentDuration,
  subagentElapsedMs,
  subagentGroupElapsedMs,
  subagentShownStep,
} from "@/features/chat/model/subagents";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { ACTIVITY_ICON_SIZE, ChatActivityLine, useActivityColors } from "./chat-activity-line";

type SubagentsMessage = Extract<ChatMessage, { kind: "subagents" }>;

const GLYPH = 18;

export interface SubagentColors {
  primary: string;
  muted: string;
  dim: string;
  border: string;
  surface: string;
  control: string;
  success: string;
  danger: string;
  accent: string;
  pressed: string;
}

export function useSubagentColors(): SubagentColors {
  const [primary, muted, dim, border, surface, control, success, danger, accent, pressed] = useCSSVariable([
    "--openbot-text-primary",
    "--openbot-text-muted",
    "--openbot-text-dim",
    "--openbot-border-strong",
    "--openbot-bg-surface",
    "--openbot-bg-control",
    "--openbot-success-text",
    "--openbot-danger-text",
    "--openbot-accent-text",
    "--openbot-bg-control-active",
  ]);
  return {
    primary: String(primary),
    muted: String(muted),
    dim: String(dim),
    border: String(border),
    surface: String(surface),
    control: String(control),
    success: String(success),
    danger: String(danger),
    accent: String(accent),
    pressed: String(pressed),
  };
}

/** The time now, again each second while `running`. */
export function useSubagentClock(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

export function Spinner({ color, size }: { color: string; size: number }) {
  const turn = useSharedValue(0);
  useEffect(() => {
    turn.set(
      withRepeat(withTiming(1, { duration: 900, easing: Easing.linear, reduceMotion: ReduceMotion.System }), -1, false),
    );
    return () => cancelAnimation(turn);
  }, [turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 360}deg` }] }));
  return (
    <Animated.View style={style}>
      <LoaderCircle size={size} color={color} />
    </Animated.View>
  );
}

/** The state of one subagent, in the icons and colors of desktop. */
export function SubagentStatusIcon({
  status,
  colors,
  size = GLYPH,
}: {
  status: ConversationSubagentStatus;
  colors: SubagentColors;
  size?: number;
}) {
  if (status === "running") return <Spinner color={colors.accent} size={size} />;
  if (status === "completed") return <CircleCheck size={size} color={colors.success} />;
  if (status === "failed") return <X size={size} color={colors.danger} />;
  return <Minus size={size} color={colors.muted} />;
}

export function SubagentRow({
  subagent,
  now,
  colors,
  first,
  lines,
  onOpen,
}: {
  subagent: ConversationSubagent;
  now: number;
  colors: SubagentColors;
  first: boolean;
  /** How many lines of the latest step or answer show. */
  lines: number;
  onOpen: (() => void) | undefined;
}) {
  const text = useText();
  const { t } = text;
  const state = t(SUBAGENT_STATE_LABELS[subagent.status]);
  const shown = subagentShownStep(subagent);
  const line = subagent.status === "failed" ? (subagent.error ?? state) : (shown?.text ?? state);
  return (
    <Pressable
      accessibilityRole={onOpen ? "button" : undefined}
      accessibilityLabel={t("mobile.chat.subagents.row", { title: subagent.title, state })}
      disabled={!onOpen}
      onPress={
        onOpen
          ? () => {
              void haptics.selection();
              onOpen();
            }
          : undefined
      }
      className="py-3 pl-3.5 pr-3"
      // A list row: the pressed row darkens, as an iOS table cell does.
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.pressed : "transparent" })}
    >
      {first ? null : (
        <View
          className="absolute top-0 right-0"
          style={{ left: 14 + GLYPH + 10, height: 0.5, backgroundColor: colors.border }}
        />
      )}
      <View className="flex-row items-center gap-2.5">
        <SubagentStatusIcon status={subagent.status} colors={colors} />
        <Typography.Paragraph
          numberOfLines={1}
          className="min-w-0 flex-1 font-medium"
          style={{ color: colors.primary }}
        >
          {subagent.title}
        </Typography.Paragraph>
        {/* The time and the arrow sit together on the title line, as the detail text of an iOS row. */}
        <View className="flex-row items-center gap-0.5">
          <Typography.Paragraph type="body-sm" style={{ color: colors.muted, fontVariant: ["tabular-nums"] }}>
            {subagentDuration(subagentElapsedMs(subagent, now), text)}
          </Typography.Paragraph>
          {onOpen ? <ChevronRight size={16} color={colors.dim} /> : null}
        </View>
      </View>
      <Typography.Paragraph
        type="body-sm"
        numberOfLines={lines}
        style={{ color: subagent.status === "failed" ? colors.danger : colors.muted, marginLeft: GLYPH + 10 }}
      >
        {line}
      </Typography.Paragraph>
    </Pressable>
  );
}

/** The title, the progress and the time of the subagents of one turn. */
export function useSubagentGroupSummary(subagents: readonly ConversationSubagent[]) {
  const text = useText();
  const { t } = text;
  const total = subagents.length;
  const running = subagents.filter((subagent) => subagent.status === "running").length;
  const failed = subagents.filter((subagent) => subagent.status === "failed").length;
  const finished = total - running;
  const now = useSubagentClock(running > 0);
  const title =
    running > 0
      ? t("mobile.chat.subagents.running", { count: total })
      : t("mobile.chat.subagents.ran", { count: total });
  const progress =
    running > 0
      ? t("mobile.chat.subagents.progress", { finished, total })
      : failed > 0
        ? `${t("mobile.chat.subagents.done", { count: finished - failed })} · ${t("mobile.chat.subagents.failed", { count: failed })}`
        : t("mobile.chat.subagents.done", { count: finished });
  const elapsed = subagentDuration(subagentGroupElapsedMs(subagents, now), text);
  return { title, progress, elapsed, now, running, failed };
}

/**
 * The subagents that the agent started in one turn, in one line: their count, their progress and
 * their time. The line opens the sheet with each subagent and its details.
 */
export function ChatSubagents({
  message,
  onOpen,
}: {
  message: SubagentsMessage;
  /** Absent where no sheet can show the subagents. */
  onOpen: ((messageId: string) => void) | undefined;
}) {
  const colors = useActivityColors();
  const { title, progress, elapsed, running, failed } = useSubagentGroupSummary(message.subagents);
  // The kind icon, or the state while subagents run or after one fails.
  const icon =
    running > 0 ? (
      <Spinner color={colors.running} size={ACTIVITY_ICON_SIZE} />
    ) : failed > 0 ? (
      <CircleX size={ACTIVITY_ICON_SIZE} color={colors.danger} />
    ) : (
      <GitFork size={ACTIVITY_ICON_SIZE} color={colors.muted} />
    );
  return (
    <ChatActivityLine
      icon={icon}
      label={title}
      meta={`${progress} · ${elapsed}`}
      accessibilityLabel={`${title}, ${progress}, ${elapsed}`}
      onPress={onOpen ? () => onOpen(message.id) : undefined}
    />
  );
}
