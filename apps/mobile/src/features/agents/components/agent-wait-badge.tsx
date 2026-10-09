import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { type LucideIcon, MessageCircleQuestionMark, MousePointer2, ShieldCheck } from "lucide-react-native";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import type { MobileAgentWaitReason } from "@/features/workspace/model/agent-activity";
import { useText } from "@/shared/lib/text";

/** One icon per wait reason, the same icons as the desktop sidebar. */
const WAIT_ICON = {
  question: MessageCircleQuestionMark,
  approval: ShieldCheck,
  takeover: MousePointer2,
} as const satisfies Record<MobileAgentWaitReason, LucideIcon>;

/** The chip in the time slot: what the user does next. */
const WAIT_ACTION = {
  question: "mobile.agent.list.waiting.action.question",
  approval: "mobile.agent.list.waiting.action.approval",
  takeover: "mobile.agent.list.waiting.action.takeover",
} as const satisfies Record<MobileAgentWaitReason, MobileTextKey>;

export const AGENT_WAIT_STATE = {
  question: "mobile.agent.list.waiting.state.question",
  approval: "mobile.agent.list.waiting.state.approval",
  takeover: "mobile.agent.list.waiting.state.takeover",
} as const satisfies Record<MobileAgentWaitReason, MobileTextKey>;

/**
 * The amber mark on the avatar of an agent that waits for the user. It sits on the avatar's
 * lower edge, as on the desktop, so it is the first mark the eye finds in a busy list.
 */
export function AgentWaitBadge({ reason, size = 20 }: { reason: MobileAgentWaitReason; size?: number }) {
  const [background] = useThemeColor(["background"]);
  // HeroUI keeps its own dark warning, a yellow. The OpenBot token is the amber of the chip and the desktop.
  const [warning] = useCSSVariable(["--openbot-warning"]);
  const Icon = WAIT_ICON[reason];
  return (
    <View
      pointerEvents="none"
      className="absolute items-center justify-center rounded-full border-2"
      style={{
        right: -3,
        bottom: -3,
        width: size,
        height: size,
        borderColor: background,
        backgroundColor: String(warning),
      }}
    >
      <Icon color={String(background)} size={Math.round(size * 0.58)} strokeWidth={2.4} />
    </View>
  );
}

/** Takes the time slot of a row: the time does not matter while the agent waits. */
export function AgentWaitChip({ reason }: { reason: MobileAgentWaitReason }) {
  const { t } = useText();
  // The label has the amber of the mark and the group count, so the three read as one state.
  const [warningSoft, warning] = useCSSVariable(["--openbot-warning-soft", "--openbot-warning"]);
  const Icon = WAIT_ICON[reason];
  return (
    <View
      className="flex-row items-center gap-1 rounded-full py-0.5 pr-2 pl-1.5"
      style={{ backgroundColor: String(warningSoft) }}
    >
      {/* Thin strokes on the tinted fill read darker than the solid mark, so the label is heavier. */}
      <Icon color={String(warning)} size={13} strokeWidth={2.8} />
      <Typography.Paragraph type="body-xs" weight="bold" style={{ color: String(warning) }} numberOfLines={1}>
        {t(WAIT_ACTION[reason])}
      </Typography.Paragraph>
    </View>
  );
}

/**
 * The heading of the "Needs you" group. The group is not a layout section, so it has no collapse
 * and no menu, the same as on the desktop.
 */
export function AgentWaitingGroupHeader({ count }: { count: number }) {
  const { t, format } = useText();
  const [background] = useThemeColor(["background"]);
  // HeroUI keeps its own dark warning, a yellow. The OpenBot token is the amber of the chip and the desktop.
  const [warning] = useCSSVariable(["--openbot-warning"]);
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={t("mobile.agent.list.waiting.label", { count })}
      className="min-h-12 flex-row items-center gap-2 px-4 pt-5 pb-2"
    >
      <Typography.Paragraph className="text-muted">{t("mobile.agent.list.waiting.title")}</Typography.Paragraph>
      <View
        className="h-5 min-w-5 items-center justify-center rounded-full px-1.5"
        style={{ backgroundColor: String(warning) }}
      >
        <Typography.Paragraph type="body-xs" weight="semibold" style={{ color: String(background) }}>
          {format.number(count)}
        </Typography.Paragraph>
      </View>
    </View>
  );
}
