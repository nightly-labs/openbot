import type { AgentContextCategory } from "@openbot/contracts/ipc";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { AgentCompactSection, AgentNewChatSection } from "@/features/agents/components/agent-chat-settings";
import { useContextUsage } from "@/features/chat/components/use-context-usage";
import {
  CONTEXT_CATEGORY_LABEL,
  type ContextUsageView,
  canCompact,
  contextCategoryRows,
  contextMeterLevel,
  usedShare,
} from "@/features/chat/model/context-usage";
import { useAgentViewOnly } from "@/features/servers/model/use-server-roles";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";

const BAR_HEIGHT = 10;

function useCategoryColors(): Record<AgentContextCategory, string> {
  const [systemPrompt, memoryFiles, tools, skills, toolResults, messages, other] = useCSSVariable([
    "--openbot-chart-storage-workspaces",
    "--openbot-chart-storage-chats",
    "--openbot-chart-storage-downloads",
    "--openbot-chart-storage-runtimes",
    "--openbot-chart-storage-files",
    "--openbot-text-secondary",
    "--openbot-text-dim",
  ]);
  return {
    systemPrompt: String(systemPrompt),
    memoryFiles: String(memoryFiles),
    tools: String(tools),
    skills: String(skills),
    toolResults: String(toolResults),
    messages: String(messages),
    other: String(other),
  };
}

export function ContextUsageScreen() {
  const { t, format } = useText();
  const { agentId, serverId, taskId, threadId } = useLocalSearchParams<{
    agentId: string;
    serverId: string;
    taskId?: string;
    threadId?: string;
  }>();
  const usage = useContextUsage({
    serverId,
    agentId,
    ...(taskId ? { task: { taskId, threadId: threadId ?? null } } : {}),
  });
  const canCompactHere = useMobileWorkspaceSelector((current) => current.canCompactContext(serverId));
  const canStartNewChat = useMobileWorkspaceSelector((current) => current.canStartNewChat(serverId));
  const agent = useMobileWorkspaceSelector((current) =>
    current.agents.find((item) => item.id === agentId && item.serverId === serverId),
  );
  const viewOnly = useAgentViewOnly(serverId, agentId);
  const colors = useCategoryColors();
  const [warning, danger, dim] = useCSSVariable(["--openbot-warning-text", "--openbot-danger", "--openbot-text-dim"]);
  if (!usage)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.chat.context.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  const compactSection =
    agent && canCompactHere && !viewOnly && canCompact(usage) ? (
      <AgentCompactSection agent={agent} available taskId={taskId} compacting={usage.compacting} />
    ) : null;
  const newChatSection =
    agent && !taskId && canStartNewChat && !viewOnly ? (
      <AgentNewChatSection agent={agent} available={!usage.compacting} />
    ) : null;
  if (usage.sizeUnknown)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.chat.context.unknown")}</SettingsNote>
        {compactSection}
        {newChatSection}
      </SettingsContent>
    );
  const share = usedShare(usage);
  const level = contextMeterLevel(usage);
  const percentColor = level === "warning" ? warning : level === "danger" ? danger : undefined;
  const rows = contextCategoryRows(usage);
  const note = [
    usage.autoCompactAt !== null
      ? t("mobile.chat.context.autoAt", {
          percent: format.percent(usage.autoCompactAt, { maximumFractionDigits: 0 }),
        })
      : t(usage.nativeManaged ? "mobile.chat.context.nativeAuto" : "mobile.chat.context.noAuto"),
    usage.lastCompaction
      ? t("mobile.chat.context.lastCompaction", {
          before: format.compact(usage.lastCompaction.beforeTokens),
          after: format.compact(usage.lastCompaction.afterTokens),
        })
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <SettingsContent>
      <SettingsSection footer={note}>
        <View className="gap-3 px-4 py-4">
          <Typography.Heading
            type="h4"
            style={percentColor === undefined ? undefined : { color: String(percentColor) }}
          >
            {t("mobile.chat.context.percent", { percent: format.percent(share, { maximumFractionDigits: 0 }) })}
          </Typography.Heading>
          <ContextBar usage={usage} colors={colors} free={String(dim)} />
          <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
            {t(usage.estimated ? "mobile.chat.context.tokensEstimated" : "mobile.chat.context.tokens", {
              used: format.compact(usage.usedTokens),
              total: format.compact(usage.windowTokens),
            })}
          </Typography.Paragraph>
        </View>
      </SettingsSection>
      {rows.length ? (
        <SettingsSection title={t("mobile.chat.context.breakdown")}>
          {[
            ...rows.map((row) => ({
              key: row.category,
              label: t(CONTEXT_CATEGORY_LABEL[row.category]),
              color: colors[row.category],
              tokens: row.tokens,
              faint: false,
            })),
            {
              key: "free",
              label: t("mobile.chat.context.category.free"),
              color: String(dim),
              tokens: Math.max(0, usage.windowTokens - usage.usedTokens),
              faint: true,
            },
          ].map((row) => (
            <SettingsRow
              key={row.key}
              disclosure={false}
              leading={
                <View
                  className="size-3 rounded-full"
                  style={{ backgroundColor: row.color, opacity: row.faint ? 0.35 : 1 }}
                />
              }
              trailing={
                <Typography.Paragraph className="text-grouped-secondary">
                  {format.compact(row.tokens)}
                </Typography.Paragraph>
              }
            >
              <Typography.Paragraph numberOfLines={1}>{row.label}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
      {compactSection}
      {newChatSection}
    </SettingsContent>
  );
}

function ContextBar({
  usage,
  colors,
  free,
}: {
  usage: ContextUsageView;
  colors: Record<AgentContextCategory, string>;
  free: string;
}) {
  const share = usedShare(usage);
  const rows = contextCategoryRows(usage);
  const rowsTotal = rows.reduce((sum, row) => sum + row.tokens, 0);
  const segments = rows.length
    ? rows.map((row) => ({ key: row.category, color: colors[row.category], grow: (share * row.tokens) / rowsTotal }))
    : [{ key: "used", color: colors.messages, grow: share }];
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ height: BAR_HEIGHT }}>
      <View className="flex-1 flex-row gap-0.5 overflow-hidden rounded-full">
        {segments.map((segment) =>
          segment.grow > 0 ? (
            <View key={segment.key} style={{ flexGrow: segment.grow, flexBasis: 0, backgroundColor: segment.color }} />
          ) : null,
        )}
        <View style={{ flexGrow: 1 - share, flexBasis: 0, backgroundColor: free, opacity: 0.35 }} />
      </View>
      {usage.autoCompactAt !== null ? (
        <View
          className="absolute w-0.5 rounded-full bg-foreground"
          style={{ start: `${usage.autoCompactAt * 100}%`, top: -2, bottom: -2 }}
        />
      ) : null}
    </View>
  );
}
