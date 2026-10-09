import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useUniwind } from "uniwind";
import { AgentUsageReport } from "@/features/agents/components/agent-usage-report";
import { UsageLoading } from "@/features/agents/components/usage-motion";
import { lastUsageDays, UsageRangePicker } from "@/features/agents/components/usage-range-picker";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** The usage of every agent of one server, as the desktop Usage panel shows it, with an agent filter. */
export function ServerUsageScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { session, sessionScope } = useMobileSession();
  const { servers, agents, loadHostAnalytics } = useMobileWorkspace();
  const server = servers.find((item) => item.id === serverId);
  const online = server?.state === "online";
  const serverAgents = agents.filter((agent) => agent.serverId === serverId);
  const [range, setRange] = useState(() => lastUsageDays());
  const [agentId, setAgentId] = useState<string>();
  useEffect(() => {
    mobileAnalytics.track("usage_viewed", {});
  }, []);
  const usage = useQuery({
    queryKey: ["server-usage", session?.apiUrl, session?.user.id, sessionScope, serverId, range, agentId],
    queryFn: () => loadHostAnalytics({ ...range, ...(agentId ? { agentId } : {}) }, serverId),
    enabled: online,
    // The last report stays on screen while the next range or agent loads, so its values change in place.
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  // As on desktop: an agent the phone does not list, such as one removed since, keeps its ID as its name.
  const agentName = (id: string) => serverAgents.find((agent) => agent.id === id)?.name ?? id;
  function selectAgent(id: string | undefined) {
    void haptics.selection();
    setAgentId(id);
  }

  if (!server)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );

  return (
    <SettingsContent>
      <View className="gap-4">
        <SettingsSection>
          <SettingsRow
            trailing={
              <SettingsPicker
                value={agentId ?? ""}
                options={[
                  { value: "", label: t("mobile.server.usage.allAgents") },
                  ...serverAgents.map((agent) => ({ value: agent.id, label: agent.name })),
                ]}
                enabled
                dark={theme === "dark"}
                label={t("mobile.server.usage.agent")}
                onChange={(value) => selectAgent(value || undefined)}
              />
            }
          >
            <Typography.Paragraph>{t("mobile.server.usage.agent")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
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
            <AgentUsageReport
              result={usage.data}
              // A filtered report splits into one row that restates the totals.
              agents={
                agentId ? undefined : usage.data.agents.map((agent) => ({ ...agent, name: agentName(agent.agentId) }))
              }
              onSelectAgent={selectAgent}
            />
          </UsageLoading>
        ) : (
          <Typography.Paragraph>{t("mobile.server.usage.unsupported")}</Typography.Paragraph>
        )}
      </View>
    </SettingsContent>
  );
}
