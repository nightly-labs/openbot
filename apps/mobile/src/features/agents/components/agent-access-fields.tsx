import { Host, Switch } from "@expo/ui";
import type { AgentAccess, AgentAdminSettings, UpdateAgentAdminSettingsInput } from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Typography } from "heroui-native";
import { useState } from "react";
import { Alert } from "react-native";
import { useUniwind } from "uniwind";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import {
  type MobileAgent,
  type MobileServer,
  useMobileWorkspace,
} from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/**
 * Access and auto-approve of an agent, read from and saved on its host. Only an owner or admin sees
 * them, and only when the host serves `agent-admin-v1`. The host checks the role again on every call.
 * A change saves at once, as on desktop and web, and does not wait for the sheet's Save action.
 */
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
  const workspace = useMobileWorkspace();
  const { session, sessionScope } = useMobileSession();
  const queryClient = useQueryClient();
  const { theme } = useUniwind();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAdminister = server?.role === "owner" || server?.role === "admin";
  // Under "agent-info", so the host's agent events refresh it with the other agent records.
  const queryKey = ["agent-info", session?.apiUrl, session?.user.id, sessionScope, agent.serverId, agent.id, "admin"];
  const settings = useQuery({
    queryKey,
    queryFn: () => workspace.loadAgentAdminSettings(agent.id, agent.serverId),
    enabled: available && canAdminister,
    retry: false,
    // Another device can change these at any time, so a reopened page reads the host again.
    staleTime: 0,
  });
  // A host without the capability answers null. A failed read keeps the controls hidden, as for a member.
  if (!canAdminister || !settings.data) return null;
  const current = settings.data;
  const enabled = available && !saving;

  async function save(input: Omit<UpdateAgentAdminSettingsInput, "agentId">): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const saved = await workspace.updateAgentAdminSettings({ agentId: agent.id, ...input }, agent.serverId);
      queryClient.setQueryData<AgentAdminSettings | null>(queryKey, saved);
      void haptics.notification("success");
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.agent.access.failed")));
    } finally {
      setSaving(false);
    }
  }

  function changeAccess(access: AgentAccess): void {
    if (access === current.access) return;
    if (access === "workspace") {
      void save({ access });
      return;
    }
    Alert.alert(t("mobile.agent.access.fullTitle"), t("mobile.agent.access.fullBody"), [
      { text: t("mobile.agent.access.fullCancel"), style: "cancel" },
      { text: t("mobile.agent.access.fullConfirm"), style: "destructive", onPress: () => void save({ access }) },
    ]);
  }

  return (
    <>
      <SettingsSection
        title={t("mobile.agent.access.title")}
        footer={
          current.autoApproveLocked
            ? t("mobile.agent.access.autoApproveLocked")
            : t("mobile.agent.access.autoApproveNote")
        }
      >
        <SettingsRow
          trailing={
            <SettingsPicker<AgentAccess>
              value={current.access}
              options={[
                { value: "workspace", label: t("mobile.agent.access.workspace") },
                { value: "full", label: t("mobile.agent.access.full") },
              ]}
              enabled={enabled}
              dark={theme === "dark"}
              label={t("mobile.agent.access.label")}
              onChange={changeAccess}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.agent.access.label")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow>
          <Host
            matchContents={{ vertical: true }}
            style={{ width: "100%" }}
            colorScheme={theme === "dark" ? "dark" : "light"}
          >
            <Switch
              value={current.autoApprove || current.autoApproveLocked}
              disabled={!enabled || current.autoApproveLocked}
              label={t("mobile.agent.access.autoApprove")}
              onValueChange={(autoApprove) => void save({ autoApprove })}
            />
          </Host>
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
