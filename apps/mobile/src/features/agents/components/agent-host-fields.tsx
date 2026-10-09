import {
  type AgentHostSettings,
  agentProviderDescriptor,
  agentProviderName,
  type BusyMessageMode,
  type UpdateAgentHostSettingsInput,
} from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Typography } from "heroui-native";
import { useState } from "react";
import { useUniwind } from "uniwind";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import {
  type MobileAgent,
  type MobileServer,
  useMobileWorkspace,
} from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** `default` follows the host default. */
type BusyMessageChoice = "default" | BusyMessageMode;

const BUSY_MESSAGE_LABEL = {
  queue: "mobile.agent.busyMessage.queue",
  steer: "mobile.agent.busyMessage.steer",
} as const satisfies Record<BusyMessageMode, MobileTextKey>;

const HOST_DEFAULT_LABEL = {
  queue: "mobile.agent.busyMessage.hostDefaultQueue",
  steer: "mobile.agent.busyMessage.hostDefaultSteer",
} as const satisfies Record<BusyMessageMode, MobileTextKey>;

interface AgentHostFieldsProps {
  agent: MobileAgent;
  server: MobileServer | undefined;
  available: boolean;
}

/**
 * Computer Use, local scripts and the busy-message mode of an agent, read from and saved on its host.
 * Only an owner or admin sees them, and only when the host serves `agent-host-settings-v1`. The host
 * checks the role again on every call. A change saves at once, as on desktop, and does not wait for
 * the sheet's Save action. The control shows the new value during the save and goes back on a failure.
 */
function useAgentHostSettings({ agent, server, available }: AgentHostFieldsProps) {
  const { t, errorMessage } = useText();
  const workspace = useMobileWorkspace();
  const { session, sessionScope } = useMobileSession();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAdminister = server?.role === "owner" || server?.role === "admin";
  // Under "agent-info" and ending in "host": the host's `agents-changed` event reads it again, so a
  // change made on another device shows here while the page is open.
  const queryKey = ["agent-info", session?.apiUrl, session?.user.id, sessionScope, agent.serverId, agent.id, "host"];
  const settings = useQuery({
    queryKey,
    queryFn: () => workspace.loadAgentHostSettings(agent.id, agent.serverId),
    enabled: available && canAdminister,
    retry: false,
    // Another device can change these at any time, so a reopened page reads the host again.
    staleTime: 0,
  });

  async function save(current: AgentHostSettings, input: Omit<UpdateAgentHostSettingsInput, "agentId">) {
    setSaving(true);
    setError(null);
    queryClient.setQueryData<AgentHostSettings | null>(queryKey, { ...current, ...input });
    try {
      const saved = await workspace.updateAgentHostSettings({ agentId: agent.id, ...input }, agent.serverId);
      queryClient.setQueryData<AgentHostSettings | null>(queryKey, saved);
      void haptics.notification("success");
    } catch (cause) {
      queryClient.setQueryData<AgentHostSettings | null>(queryKey, current);
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.agent.host.failed")));
    } finally {
      setSaving(false);
    }
  }

  // A host without the capability answers null. A failed read keeps the controls hidden, as for a member.
  const current = canAdminister ? (settings.data ?? null) : null;
  return { current, enabled: available && !saving, error, save };
}

function SaveError({ error }: { error: string | null }) {
  return error ? (
    <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
      {error}
    </Typography.Paragraph>
  ) : null;
}

/** Agent info > Permissions: Computer Use and local scripts, which act on the host computer. */
export function AgentHostPermissionFields(props: AgentHostFieldsProps) {
  const { t } = useText();
  const { theme } = useUniwind();
  const { current, enabled, error, save } = useAgentHostSettings(props);
  if (!current) return null;
  return (
    <>
      <SettingsSection footer={t("mobile.agent.host.computerUseFooter")}>
        <SettingsRow>
          <SettingsSwitch
            value={current.computerUse}
            disabled={!enabled}
            label={t("mobile.agent.host.computerUse")}
            dark={theme === "dark"}
            onValueChange={(computerUse) => void save(current, { computerUse })}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection footer={t("mobile.agent.host.automationFooter")}>
        <SettingsRow>
          <SettingsSwitch
            value={current.allowAutomation}
            disabled={!enabled}
            label={t("mobile.agent.host.automation")}
            dark={theme === "dark"}
            onValueChange={(allowAutomation) => void save(current, { allowAutomation })}
          />
        </SettingsRow>
      </SettingsSection>
      <SaveError error={error} />
    </>
  );
}

/** Agent info > Advanced: what a message sent while the agent works does. */
export function AgentBusyMessageField(props: AgentHostFieldsProps) {
  const { t } = useText();
  const { theme } = useUniwind();
  const { current, enabled, error, save } = useAgentHostSettings(props);
  if (!current) return null;
  const { agent } = props;
  const choice: BusyMessageChoice = current.busyMessageMode ?? "default";
  const mode = current.busyMessageMode ?? current.defaultBusyMessageMode;
  const steerUnsupported =
    mode === "steer" && agent.provider !== undefined && agentProviderDescriptor(agent.provider).steer !== "native";
  return (
    <>
      <SettingsSection
        footer={
          steerUnsupported && agent.provider
            ? t("mobile.agent.busyMessage.steerUnsupported", { provider: agentProviderName(agent.provider) })
            : t("mobile.agent.busyMessage.footer")
        }
      >
        <SettingsRow
          trailing={
            <SettingsPicker<BusyMessageChoice>
              value={choice}
              options={[
                { value: "default", label: t(HOST_DEFAULT_LABEL[current.defaultBusyMessageMode]) },
                { value: "queue", label: t(BUSY_MESSAGE_LABEL.queue) },
                { value: "steer", label: t(BUSY_MESSAGE_LABEL.steer) },
              ]}
              enabled={enabled}
              dark={theme === "dark"}
              label={t("mobile.agent.busyMessage.label")}
              onChange={(next) => {
                if (next !== choice) void save(current, { busyMessageMode: next === "default" ? null : next });
              }}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.agent.busyMessage.label")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SaveError error={error} />
    </>
  );
}
