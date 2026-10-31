import {
  type AgentHostSettings,
  type AgentNewChatSettings,
  agentProviderDescriptor,
  agentProviderName,
  type BusyMessageMode,
  canAdministerServer,
  type UpdateAgentHostSettingsInput,
} from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Typography } from "heroui-native";
import { useState } from "react";
import { useUniwind } from "uniwind";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import {
  type MobileAgent,
  type MobileServer,
  useMobileWorkspaceActions,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
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
 * One group of agent settings that the host keeps, read from and saved on the host. Only an owner or
 * admin sees them, and only when the host serves their capability: a host without it answers null.
 * The host checks the role again on every call. A change saves at once, as on desktop, and does not
 * wait for the sheet's Save action. The control shows the new value during the save and goes back on
 * a failure.
 */
function useAgentSetting<Settings extends object, Input extends Partial<Settings>>(
  { agent, server, available }: AgentHostFieldsProps,
  part: "host" | "new-chat",
  load: () => Promise<Settings | null>,
  update: (input: Input) => Promise<Settings>,
) {
  const { t, errorMessage } = useText();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAdminister = canAdministerServer(server?.role);
  // Under "agent-info" and ending in a part of `AGENT_SETTINGS_PARTS`: the host's `agents-changed`
  // event reads it again, so a change made on another device shows here while the page is open.
  const queryKey = queryKeys.agentRecord(queryScope, agent.serverId, agent.id, part);
  const settings = useQuery({
    queryKey,
    queryFn: load,
    enabled: available && canAdminister,
    retry: false,
    // Another device can change these at any time, so a reopened page reads the host again.
    staleTime: 0,
  });

  async function save(current: Settings, input: Input) {
    setSaving(true);
    setError(null);
    const next: Settings = { ...current, ...input };
    queryClient.setQueryData<Settings | null>(queryKey, next);
    try {
      const saved = await update(input);
      queryClient.setQueryData<Settings | null>(queryKey, saved);
      void haptics.notification("success");
    } catch (cause) {
      queryClient.setQueryData<Settings | null>(queryKey, current);
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.agent.host.failed")));
    } finally {
      setSaving(false);
    }
  }

  // A failed read keeps the controls hidden, as for a member.
  const current = canAdminister ? (settings.data ?? null) : null;
  return { current, enabled: available && !saving, error, save };
}

/** Computer Use, local scripts and the busy-message mode of an agent, on `agent-host-settings-v1`. */
function useAgentHostSettings(props: AgentHostFieldsProps) {
  const workspace = useMobileWorkspaceActions();
  const { agent } = props;
  return useAgentSetting<AgentHostSettings, Omit<UpdateAgentHostSettingsInput, "agentId">>(
    props,
    "host",
    () => workspace.loadAgentHostSettings(agent.id, agent.serverId),
    (input) => workspace.updateAgentHostSettings({ agentId: agent.id, ...input }, agent.serverId),
  );
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

/**
 * Agent info > Advanced: whether the agent starts a new chat itself when its chat gets long, as on
 * desktop, on `agent-new-chat-v1`. A change on desktop shows here while the page is open, and a
 * change here shows on desktop at once.
 */
export function AgentNewChatAllowedField(props: AgentHostFieldsProps) {
  const { t } = useText();
  const { theme } = useUniwind();
  const workspace = useMobileWorkspaceActions();
  const { agent } = props;
  const { current, enabled, error, save } = useAgentSetting<AgentNewChatSettings, AgentNewChatSettings>(
    props,
    "new-chat",
    () => workspace.loadAgentNewChat(agent.id, agent.serverId),
    (input) => workspace.updateAgentNewChat({ agentId: agent.id, ...input }, agent.serverId),
  );
  if (!current) return null;
  return (
    <>
      <SettingsSection footer={t("mobile.agent.agentNewChat.footer")}>
        <SettingsRow>
          <SettingsSwitch
            value={current.allowNewChat}
            disabled={!enabled}
            label={t("mobile.agent.agentNewChat.title")}
            dark={theme === "dark"}
            onValueChange={(allowNewChat) => void save(current, { allowNewChat })}
          />
        </SettingsRow>
      </SettingsSection>
      <SaveError error={error} />
    </>
  );
}
