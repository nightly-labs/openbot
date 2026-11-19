import type { ConversationSubagent, ConversationSubagentStepKind } from "@openbot/contracts/ipc";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import Brain from "lucide-react-native/icons/brain";
import Code from "lucide-react-native/icons/code";
import File from "lucide-react-native/icons/file";
import Globe from "lucide-react-native/icons/globe";
import MessageCircle from "lucide-react-native/icons/message-circle";
import Pencil from "lucide-react-native/icons/pencil";
import Puzzle from "lucide-react-native/icons/puzzle";
import Search from "lucide-react-native/icons/search";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { View } from "react-native";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { useText } from "@/shared/lib/text";
import {
  SubagentRow,
  SubagentStatusIcon,
  useSubagentClock,
  useSubagentColors,
  useSubagentGroupSummary,
} from "../components/chat-subagents";
import { firstParam, useConversationMessage } from "../components/use-conversation-message";
import { GENERAL_AGENT_TYPE, SUBAGENT_STATE_LABELS, subagentDuration, subagentElapsedMs } from "../model/subagents";

const STEP_ICONS: Record<ConversationSubagentStepKind, LucideIcon> = {
  thinking: Brain,
  text: MessageCircle,
  search: Search,
  read: File,
  edit: Pencil,
  command: Code,
  web: Globe,
  tool: Puzzle,
};

const NO_SUBAGENTS: readonly ConversationSubagent[] = [];

function useSubagents(agentId: string, messageId: string): readonly ConversationSubagent[] {
  return useConversationMessage(agentId, messageId)?.subagents ?? NO_SUBAGENTS;
}

export function SubagentsScreen() {
  const colors = useSubagentColors();
  const params = useLocalSearchParams<{ agentId: string; serverId?: string; messageId: string }>();
  const agentId = firstParam(params.agentId) ?? "";
  const serverId = firstParam(params.serverId);
  const messageId = firstParam(params.messageId) ?? "";
  const subagents = useSubagents(agentId, messageId);
  const { title, progress, elapsed, now } = useSubagentGroupSummary(subagents);
  return (
    <SheetScrollView contentContainerClassName="gap-4 px-5 pb-safe-offset-8 pt-5" keyboardAware={false}>
      <Stack.Screen options={{ title }} />
      <Typography.Paragraph type="body-sm" style={{ color: colors.muted, fontVariant: ["tabular-nums"] }}>
        {`${progress} · ${elapsed}`}
      </Typography.Paragraph>
      {subagents.length > 0 ? (
        <View
          className="overflow-hidden rounded-[18px]"
          style={{ backgroundColor: colors.surface, borderCurve: "continuous" }}
        >
          {subagents.map((subagent, index) => (
            <SubagentRow
              key={subagent.id}
              subagent={subagent}
              now={now}
              colors={colors}
              first={index === 0}
              lines={3}
              onOpen={() =>
                router.push({
                  pathname: "/subagent/detail",
                  params: { agentId, ...(serverId ? { serverId } : {}), messageId, subagentId: subagent.id },
                })
              }
            />
          ))}
        </View>
      ) : null}
    </SheetScrollView>
  );
}

export function SubagentScreen() {
  const text = useText();
  const { t } = text;
  const colors = useSubagentColors();
  const params = useLocalSearchParams<{ agentId: string; serverId?: string; messageId: string; subagentId: string }>();
  const agentId = firstParam(params.agentId) ?? "";
  const serverId = firstParam(params.serverId);
  const messageId = firstParam(params.messageId) ?? "";
  const subagentId = firstParam(params.subagentId) ?? "";
  const agentName = useMobileWorkspaceSelector(
    (current) =>
      current.agents.find(
        (candidate) => candidate.id === agentId && (serverId === undefined || candidate.serverId === serverId),
      )?.name ?? "",
  );
  const subagent = useSubagents(agentId, messageId).find((candidate) => candidate.id === subagentId);
  const now = useSubagentClock(subagent?.status === "running");
  if (!subagent) return <SheetScrollView contentContainerClassName="px-5 pb-safe-offset-8 pt-5" />;
  const meta = [
    subagent.agentType === GENERAL_AGENT_TYPE ? null : subagent.agentType,
    t(SUBAGENT_STATE_LABELS[subagent.status]),
    subagentDuration(subagentElapsedMs(subagent, now), text),
    t("mobile.chat.subagents.stepCount", { count: subagent.steps.length }),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <SheetScrollView contentContainerClassName="gap-5 px-5 pb-safe-offset-8 pt-5" keyboardAware={false}>
      <View className="gap-1">
        <View className="flex-row items-start gap-2.5">
          <View className="h-7 justify-center">
            <SubagentStatusIcon status={subagent.status} colors={colors} size={20} />
          </View>
          <Typography.Heading type="h4" className="min-w-0 flex-1" selectable>
            {subagent.title}
          </Typography.Heading>
        </View>
        <Typography.Paragraph type="body-sm" style={{ color: colors.muted, marginLeft: 30 }}>
          {meta}
        </Typography.Paragraph>
      </View>
      {subagent.prompt ? (
        <View
          className="gap-1.5 rounded-[16px] px-4 py-3"
          style={{ backgroundColor: colors.surface, borderCurve: "continuous" }}
        >
          <Typography.Paragraph type="body-xs" className="font-medium" style={{ color: colors.muted }}>
            {t("mobile.chat.subagents.taskFrom", { name: agentName })}
          </Typography.Paragraph>
          <Typography.Paragraph type="body-sm" selectable style={{ color: colors.primary }}>
            {subagent.prompt}
          </Typography.Paragraph>
        </View>
      ) : null}
      {subagent.steps.length > 0 ? (
        <View className="gap-3">
          {subagent.steps.map((step) => {
            const Icon = STEP_ICONS[step.kind];
            const answer = step.kind === "text";
            return (
              <View key={step.id} className="flex-row gap-3">
                <View className="h-5 justify-center">
                  <Icon size={15} color={colors.muted} />
                </View>
                <Typography.Paragraph
                  type={answer ? "body" : "body-sm"}
                  selectable
                  className="min-w-0 flex-1"
                  style={{
                    color: answer ? colors.primary : colors.muted,
                    fontFamily: step.kind === "command" ? "Menlo" : undefined,
                  }}
                >
                  {step.text}
                </Typography.Paragraph>
              </View>
            );
          })}
        </View>
      ) : null}
      {subagent.error ? (
        <View className="flex-row gap-3">
          <View className="h-5 justify-center">
            <TriangleAlert size={15} color={colors.danger} />
          </View>
          <Typography.Paragraph type="body-sm" selectable className="min-w-0 flex-1" style={{ color: colors.danger }}>
            {subagent.error}
          </Typography.Paragraph>
        </View>
      ) : null}
    </SheetScrollView>
  );
}
