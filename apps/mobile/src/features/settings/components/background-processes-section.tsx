import type { BackgroundProcess } from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Typography } from "heroui-native";
import Server from "lucide-react-native/icons/server";
import Square from "lucide-react-native/icons/square";
import { useState } from "react";
import { Alert, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { AgentDefaultsAvatar, AgentDefaultsError } from "@/features/settings/components/agent-defaults-parts";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const ICON_SIZE = 26;
const STARTED_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

/**
 * Settings > Agents > Background processes of one server (`background-processes-v1`): the programs
 * that its agents started and left running, such as a dev server, each with Stop. As the section of
 * the desktop Settings > Agents. The host has no event for these programs, so the page reads them
 * each time it opens. Nothing shows for a host without the capability, or one that cannot find these
 * programs, as on Windows.
 */
export function BackgroundProcessesSection({ serverId, online }: { serverId: string; online: boolean }) {
  const { t, format, errorMessage } = useText();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const { loadBackgroundProcesses, stopBackgroundProcess } = useMobileWorkspaceActions();
  const available = useMobileWorkspaceSelector((workspace) => workspace.canManageBackgroundProcesses(serverId));
  const agents = useMobileWorkspaceSelector((workspace) => workspace.agents);
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const queryKey = queryKeys.backgroundProcesses(queryScope, serverId);
  const query = useQuery({
    queryKey,
    enabled: online && available,
    retry: false,
    staleTime: 0,
    queryFn: () => loadBackgroundProcesses(serverId),
  });
  const [stopping, setStopping] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);

  if (!available || query.data === null) return null;

  const agentOf = (process: BackgroundProcess) =>
    process.agentId === null
      ? undefined
      : agents.find((agent) => agent.serverId === serverId && agent.id === process.agentId);
  const details = (process: BackgroundProcess) =>
    [
      agentOf(process)?.name ?? t("mobile.settings.agents.processes.noAgent"),
      t("mobile.settings.agents.processes.started", { time: format.date(process.startedAt, STARTED_FORMAT) }),
      ...(process.ports.length > 0
        ? [
            t("mobile.settings.agents.processes.ports", {
              count: process.ports.length,
              ports: format.list(process.ports.map(String)),
            }),
          ]
        : []),
    ].join(" · ");

  async function stop(process: BackgroundProcess): Promise<void> {
    setStopping((current) => [...current, process.id]);
    setError(null);
    try {
      await stopBackgroundProcess(process.id, serverId);
      void haptics.notification("success");
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.settings.agents.processes.stopFailed")));
    } finally {
      setStopping((current) => current.filter((id) => id !== process.id));
      void queryClient.invalidateQueries({ queryKey, exact: true });
    }
  }

  function confirmStop(process: BackgroundProcess): void {
    Alert.alert(t("mobile.settings.agents.processes.stopTitle"), process.command, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("mobile.settings.agents.processes.stop"),
        style: "destructive",
        onPress: () => void stop(process),
      },
    ]);
  }

  const processes = query.data ?? [];
  // With no program to show, a message takes the place of the rows, as a row of the card.
  const message =
    processes.length > 0
      ? null
      : query.isError
        ? errorMessage(query.error, t("mobile.settings.agents.processes.loadFailed"))
        : !online
          ? t("mobile.settings.agents.offline")
          : query.data === undefined
            ? t("common.loading")
            : t("mobile.settings.agents.processes.empty");

  return (
    <>
      <SettingsSection
        title={t("mobile.settings.agents.processes.title")}
        footer={t("mobile.settings.agents.processes.description")}
      >
        {message ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">{message}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {processes.map((process) => {
          const agent = agentOf(process);
          return (
            <SettingsRow
              key={process.id}
              disclosure={false}
              supportingText={details(process)}
              leading={
                agent ? (
                  <AgentDefaultsAvatar agent={agent} />
                ) : (
                  <View style={{ width: ICON_SIZE, alignItems: "center" }}>
                    <Server size={20} color={muted} strokeWidth={1.5} />
                  </View>
                )
              }
              trailing={
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  isDisabled={!online || stopping.includes(process.id)}
                  accessibilityLabel={t("mobile.settings.agents.processes.stopLabel", { pid: String(process.pid) })}
                  onPress={() => confirmStop(process)}
                >
                  <Square color={muted} fill={muted} size={14} strokeWidth={1.75} />
                </Button>
              }
            >
              <Typography.Paragraph type="body-sm" numberOfLines={2}>
                {process.command}
              </Typography.Paragraph>
            </SettingsRow>
          );
        })}
      </SettingsSection>
      <AgentDefaultsError error={error} />
    </>
  );
}
