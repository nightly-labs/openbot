import type { AnalyticsAgent } from "@openbot/contracts/ipc";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { AgentProviderAvatar } from "@/features/agents/components/agent-provider-avatar";
import { AgentUsageReport, type UsageAgentRow } from "@/features/agents/components/agent-usage-report";
import { UsageLoading } from "@/features/agents/components/usage-motion";
import { lastUsageDays, UsageRangePicker } from "@/features/agents/components/usage-range-picker";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { PlanLimitsSummary } from "@/features/servers/components/plan-limits-summary";
import { SettingsNote } from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { LargeTitleScrollView } from "@/shared/components/large-title";
import { useText } from "@/shared/lib/text";

const AGENT_AVATAR_SIZE = 36;

/** The usage of every agent of one server, as the desktop Usage panel shows it. An agent row opens that agent's usage. */
export function ServerUsageScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const queryScope = useQueryScope();
  const { servers, agents, loadHostAnalytics } = useMobileWorkspace();
  const server = servers.find((item) => item.id === serverId);
  const online = server?.state === "online";
  const serverAgents = agents.filter((agent) => agent.serverId === serverId);
  const [range, setRange] = useState(() => lastUsageDays());
  useEffect(() => {
    mobileAnalytics.track("usage_viewed", { scope: "server" });
  }, []);
  const usage = useQuery({
    queryKey: queryKeys.serverUsage(queryScope, serverId, range),
    queryFn: () => loadHostAnalytics(range, serverId),
    enabled: online,
    // The last report stays on screen while the next range loads, so its values change in place.
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  // As on desktop: an agent the phone does not list, such as one removed since, keeps its ID as its name.
  function agentRow(row: AnalyticsAgent): UsageAgentRow {
    const agent = serverAgents.find((item) => item.id === row.agentId);
    return agent
      ? {
          ...row,
          name: agent.name,
          avatar: <AgentProviderAvatar agent={agent} size={AGENT_AVATAR_SIZE} />,
          onPress: () =>
            router.push({
              pathname: "/agent-info/[agentId]/usage",
              // The agent's usage opens on the range of this screen.
              params: { agentId: agent.id, serverId: agent.serverId, ...range },
            }),
        }
      : { ...row, name: row.agentId };
  }

  const title = t("mobile.app.route.usage");
  if (!server)
    return (
      <LargeTitleScrollView title={title} contentContainerClassName="px-4 pt-3">
        <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>
      </LargeTitleScrollView>
    );

  return (
    <LargeTitleScrollView title={title} caption={server.name} contentContainerClassName="px-4 pt-3">
      <View className="gap-4">
        {/* Above the range: the limits are the provider's now, not of a range. */}
        <PlanLimitsSummary serverId={server.id} />
        <UsageRangePicker range={range} onChange={setRange} />
        {!online ? (
          <Typography.Paragraph>{t("mobile.agent.info.usage.reconnect")}</Typography.Paragraph>
        ) : usage.isPending ? (
          <Typography.Paragraph>{t("mobile.agent.info.usage.loading")}</Typography.Paragraph>
        ) : usage.isError ? (
          <View className="gap-2">
            <Typography.Paragraph accessibilityRole="alert">{t("mobile.agent.info.usage.failed")}</Typography.Paragraph>
            <Button variant="ghost" onPress={() => void usage.refetch()}>
              <Button.Label>{t("mobile.agent.info.usage.retry")}</Button.Label>
            </Button>
          </View>
        ) : usage.data ? (
          <UsageLoading loading={usage.isPlaceholderData}>
            <AgentUsageReport result={usage.data} agents={usage.data.agents.map(agentRow)} />
          </UsageLoading>
        ) : (
          <Typography.Paragraph>{t("mobile.server.usage.unsupported")}</Typography.Paragraph>
        )}
      </View>
    </LargeTitleScrollView>
  );
}
