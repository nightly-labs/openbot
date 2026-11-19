import {
  type AgentAdminSettings,
  type AgentPermissionLevel,
  agentPermissionLevel,
  agentPermissionLevels,
  agentPermissionUpdate,
  canAdministerServer,
  widensAgentPermission,
} from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Typography } from "heroui-native";
import { useState } from "react";
import { Alert } from "react-native";
import { useUniwind } from "uniwind";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import {
  type MobileAgent,
  type MobileServer,
  useMobileWorkspaceActions,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function useAgentAdminSettings(agent: MobileAgent, server: MobileServer | undefined, available: boolean) {
  const workspace = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const canAdminister = canAdministerServer(server?.role);
  const queryKey = queryKeys.agentRecord(queryScope, agent.serverId, agent.id, "admin");
  const settings = useQuery({
    queryKey,
    queryFn: () => workspace.loadAgentAdminSettings(agent.id, agent.serverId),
    enabled: available && canAdminister,
    retry: false,
    staleTime: 0,
  });
  return { queryKey, settings: canAdminister ? (settings.data ?? null) : null };
}

export function AgentAccessFields({
  agent,
  server,
  available,
}: {
  agent: MobileAgent;
  server: MobileServer | undefined;
  available: boolean;
}) {
  const { t, errorMessage } = useText();
  const workspace = useMobileWorkspaceActions();
  const queryClient = useQueryClient();
  const { theme } = useUniwind();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { queryKey, settings } = useAgentAdminSettings(agent, server, available);
  if (!settings) return null;
  const current = agentPermissionLevel(settings);
  const locked = settings.autoApproveLocked;
  const enabled = available && !saving;

  async function save(level: AgentPermissionLevel): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const saved = await workspace.updateAgentAdminSettings(agentPermissionUpdate(agent.id, level), agent.serverId);
      queryClient.setQueryData<AgentAdminSettings | null>(queryKey, saved);
      void haptics.notification("success");
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.agent.access.failed")));
    } finally {
      setSaving(false);
    }
  }

  function changeLevel(level: AgentPermissionLevel): void {
    if (level === current) return;
    if (!widensAgentPermission(current, level)) {
      void save(level);
      return;
    }
    const reach = current === "workspace" ? `${t("mobile.agent.access.fullBody")} ` : "";
    const ask = level === "ask";
    Alert.alert(
      t(ask ? "mobile.agent.access.askTitle" : "mobile.agent.access.fullTitle"),
      `${reach}${t(ask ? "mobile.agent.access.askNote" : "mobile.agent.access.noApproval")}`,
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t(ask ? "mobile.agent.access.askConfirm" : "mobile.agent.access.fullConfirm"),
          style: "destructive",
          onPress: () => void save(level),
        },
      ],
    );
  }

  return (
    <>
      <SettingsSection
        title={t("mobile.agent.access.title")}
        footer={locked ? t("mobile.agent.access.autoApproveLocked") : t(PERMISSION_NOTE[current])}
      >
        <SettingsRow
          trailing={
            <SettingsPicker<AgentPermissionLevel>
              value={current}
              options={agentPermissionLevels(agent.provider, current).map((level) => ({
                value: level,
                label: t(PERMISSION_LABEL[level]),
              }))}
              enabled={enabled}
              dark={theme === "dark"}
              label={t("mobile.agent.access.label")}
              onChange={changeLevel}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.agent.access.label")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
    </>
  );
}

export const PERMISSION_LABEL = {
  workspace: "mobile.agent.access.workspace",
  ask: "mobile.agent.access.ask",
  full: "mobile.agent.access.full",
} as const satisfies Record<AgentPermissionLevel, MobileTextKey>;

const PERMISSION_NOTE = {
  workspace: "mobile.agent.access.workspaceNote",
  ask: "mobile.agent.access.askNote",
  full: "mobile.agent.access.fullNote",
} as const satisfies Record<AgentPermissionLevel, MobileTextKey>;
