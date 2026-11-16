import type { AgentContextCategory } from "@openbot/contracts/ipc";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useState } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { AgentNewChatSection } from "@/features/agents/components/agent-chat-settings";
import { showFailureAlert } from "@/features/analytics/failure-reports";
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
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

const BAR_HEIGHT = 10;

/** The colour of each category, as in the desktop popover. */
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

/**
 * The context sheet of the composer's ring: how full the chat's context is, what fills it, and Compact
 * now, as the popover of the desktop ring. It reads the host's live state, so it follows a compaction.
 */
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
  // New chat acts on the agent's own chat only, as on the desktop: a side thread has no New chat.
  const agent = useMobileWorkspaceSelector((current) =>
    taskId ? undefined : current.agents.find((item) => item.id === agentId && item.serverId === serverId),
  );
  const viewOnly = useAgentViewOnly(serverId, agentId);
  const colors = useCategoryColors();
  const [secondary, warning, danger, dim] = useCSSVariable([
    "--openbot-text-grouped-secondary",
    "--openbot-warning-text",
    "--openbot-danger",
    "--openbot-text-dim",
  ]);
  if (!usage)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.chat.context.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  const share = usedShare(usage);
  const level = contextMeterLevel(usage);
  const percentColor = level === "warning" ? warning : level === "danger" ? danger : secondary;
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
          {/* The sheet's title already says Context, so the figure leads. */}
          <Typography.Heading
            type="h4"
            style={level === "quiet" || level === "normal" ? undefined : { color: String(percentColor) }}
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
      {canCompactHere && !viewOnly && canCompact(usage) ? (
        <CompactSection agentId={agentId} serverId={serverId} taskId={taskId} compacting={usage.compacting} />
      ) : null}
      {agent && canStartNewChat && !viewOnly ? (
        // The sheet shows only while the host is online. As on the desktop, a running compaction holds it.
        <AgentNewChatSection agent={agent} available={!usage.compacting} />
      ) : null}
    </SettingsContent>
  );
}

/** The used share, split by category when the provider gives one, then free space, with a tick at auto-compaction. */
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

/**
 * Compact now, as on the desktop. The host refuses while the chat runs a turn or has a queued
 * message, or when its provider cannot compact; its reason shows in the alert. The ring and this
 * sheet follow the compaction from the host's live state.
 */
function CompactSection({
  agentId,
  serverId,
  taskId,
  compacting,
}: {
  agentId: string;
  serverId: string;
  taskId: string | undefined;
  compacting: boolean;
}) {
  const { t } = useText();
  const { compactContext } = useMobileWorkspaceActions();
  const [requesting, setRequesting] = useState(false);
  const compact = () => {
    setRequesting(true);
    compactContext(agentId, serverId, taskId)
      .then(() => void haptics.notification("success"))
      .catch((cause: unknown) => {
        void haptics.notification("error");
        const text = currentText();
        showFailureAlert(
          cause,
          "agent",
          text.t("mobile.agent.compact.failed"),
          text.errorMessage(cause, text.t("mobile.agent.compact.failedBody")),
        );
      })
      .finally(() => setRequesting(false));
  };
  const label = compacting
    ? t("mobile.chat.context.labelCompacting")
    : requesting
      ? t("mobile.agent.compact.compacting")
      : t("mobile.agent.compact.title");
  return (
    <SettingsSection footer={t("mobile.agent.compact.footer")}>
      <SettingsRow disclosure={false} disabled={compacting || requesting} onPress={compact}>
        <Typography.Paragraph className="text-accent">{label}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}
