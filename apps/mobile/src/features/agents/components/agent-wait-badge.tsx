import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import MessageCircleQuestionMark from "lucide-react-native/icons/message-circle-question-mark";
import MousePointer2 from "lucide-react-native/icons/mouse-pointer-2";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { useAvatarHole } from "@/features/agents/components/avatar-cutout";
import type { MobileAgentWaitReason } from "@/features/workspace/model/agent-activity";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const WAIT_ICON = {
  question: MessageCircleQuestionMark,
  approval: ShieldCheck,
  takeover: MousePointer2,
} as const satisfies Record<MobileAgentWaitReason, LucideIcon>;

const WAIT_RING = 3;

export const AGENT_WAIT_ACTION = {
  question: "mobile.agent.list.waiting.action.question",
  approval: "mobile.agent.list.waiting.action.approval",
  takeover: "mobile.agent.list.waiting.action.takeover",
} as const satisfies Record<MobileAgentWaitReason, MobileTextKey>;

export const AGENT_WAIT_STATE = {
  question: "mobile.agent.list.waiting.state.question",
  approval: "mobile.agent.list.waiting.state.approval",
  takeover: "mobile.agent.list.waiting.state.takeover",
} as const satisfies Record<MobileAgentWaitReason, MobileTextKey>;

export function agentListStateLabel(
  t: MobileTranslate,
  label: string,
  waitReason: MobileAgentWaitReason | undefined,
  unreadCount: number,
  unreadThreads: boolean,
): string {
  if (waitReason) return t("mobile.agent.list.withState", { label, state: t(AGENT_WAIT_STATE[waitReason]) });
  if (unreadCount > 0 || unreadThreads)
    return t("mobile.agent.list.withState", {
      label,
      state:
        unreadCount > 0 ? t("mobile.agent.list.unread", { count: unreadCount }) : t("mobile.agent.list.unreadThreads"),
    });
  return label;
}

export function AgentWaitBadge({ reason, size = 20 }: { reason: MobileAgentWaitReason; size?: number }) {
  const [background] = useThemeColor(["background"]);
  const [warning] = useCSSVariable(["--openbot-warning"]);
  const Icon = WAIT_ICON[reason];
  const reportHole = useAvatarHole();
  return (
    <View
      pointerEvents="none"
      className="absolute rounded-full"
      onLayout={reportHole}
      style={{
        right: -1 - WAIT_RING,
        bottom: -1 - WAIT_RING,
        padding: WAIT_RING,
        backgroundColor: reportHole ? "transparent" : background,
      }}
    >
      <View
        className="items-center justify-center rounded-full"
        style={{ width: size - 4, height: size - 4, backgroundColor: String(warning) }}
      >
        <Icon color={String(background)} size={Math.round(size * 0.58)} strokeWidth={2.4} />
      </View>
    </View>
  );
}

export function AgentWaitChip({ reason }: { reason: MobileAgentWaitReason }) {
  const { t } = useText();
  const [warningSoft, warning] = useCSSVariable(["--openbot-warning-soft", "--openbot-warning"]);
  const Icon = WAIT_ICON[reason];
  return (
    <View
      className="flex-row items-center gap-1 rounded-full py-0.5 pr-2 pl-1.5"
      style={{ backgroundColor: String(warningSoft) }}
    >
      <Icon color={String(warning)} size={13} strokeWidth={2.8} />
      <Typography.Paragraph
        className="font-bold"
        style={[typeScale.small, { color: String(warning) }]}
        numberOfLines={1}
      >
        {t(AGENT_WAIT_ACTION[reason])}
      </Typography.Paragraph>
    </View>
  );
}

export function AgentWaitingGroupHeader({ count }: { count: number }) {
  const { t, format } = useText();
  const [background] = useThemeColor(["background"]);
  const [warning] = useCSSVariable(["--openbot-warning"]);
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={t("mobile.agent.list.waiting.label", { count })}
      className="flex-row items-center gap-1.5 px-5 pt-5 pb-1.5"
    >
      <Typography.Paragraph className="font-medium text-muted" style={typeScale.caption}>
        {t("mobile.agent.list.waiting.title")}
      </Typography.Paragraph>
      <View
        className="h-5 min-w-5 items-center justify-center rounded-full px-1.5"
        style={{ backgroundColor: String(warning) }}
      >
        <Typography.Paragraph className="font-semibold" style={[typeScale.small, { color: String(background) }]}>
          {format.number(count)}
        </Typography.Paragraph>
      </View>
    </View>
  );
}

export function AgentUnreadGroupHeader({ count }: { count: number }) {
  const { t, format } = useText();
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={t("mobile.agent.list.unreadGroup.label", { count })}
      className="flex-row items-center gap-1.5 px-5 pt-5 pb-1.5"
    >
      <Typography.Paragraph className="font-medium text-muted" style={typeScale.caption}>
        {t("mobile.agent.list.unreadGroup.title")}
      </Typography.Paragraph>
      <View className="h-5 min-w-5 items-center justify-center rounded-full bg-default px-1.5">
        <Typography.Paragraph className="font-semibold text-muted" style={typeScale.small}>
          {format.number(count)}
        </Typography.Paragraph>
      </View>
    </View>
  );
}
