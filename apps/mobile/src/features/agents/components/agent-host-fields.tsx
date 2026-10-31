import {
  AGENT_TASK_LIMIT_DEFAULT,
  AGENT_TASK_LIMIT_MAX,
  type AgentHostSettings,
  type AgentNewChatSettings,
  type AgentPlanCardSettings,
  type AgentTaskLimitSettings,
  agentProviderDescriptor,
  agentProviderName,
  type BusyMessageMode,
  canAdministerServer,
  type UpdateAgentHostSettingsInput,
} from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Typography } from "heroui-native";
import { useRef, useState } from "react";
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
type TaskLimitChoice = "default" | number;
const TASK_LIMIT_CHOICES: readonly TaskLimitChoice[] = [
  "default",
  ...Array.from({ length: AGENT_TASK_LIMIT_MAX }, (_, index) => index + 1),
];

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

export interface AgentHostFieldsProps {
  agent: MobileAgent;
  server: MobileServer | undefined;
  available: boolean;
}

/**
 * One agent setting that is read from and saved on the agent's host. Only an owner or admin sees
 * it, and only when the host serves its capability. The host checks the role again on every call.
 * A change saves at once, as on desktop, and does not wait for the sheet's Save action. The control
 * shows the new value during the save and goes back on a failure.
 */
export function useAgentHostRecord<Settings extends object, Input extends Partial<Settings>>(
  { agent, server, available }: AgentHostFieldsProps,
  part: "host" | "task-limit" | "new-chat" | "plan-card" | "backup-models",
  load: (agentId: string, serverId: string) => Promise<Settings | null>,
  update: (input: Input & { agentId: string }, serverId: string) => Promise<Settings>,
) {
  const { t, errorMessage } = useText();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A second tap can come before the render that disables the control, and it would save from the same value.
  const pending = useRef(false);
  const canAdminister = canAdministerServer(server?.role);
  // Under "agent-info" and ending in an `AGENT_SETTINGS_PARTS` part: the host's `agents-changed`
  // event reads it again, so a change made on another device shows here while the page is open.
  const queryKey = queryKeys.agentRecord(queryScope, agent.serverId, agent.id, part);
  const settings = useQuery({
    queryKey,
    queryFn: () => load(agent.id, agent.serverId),
    enabled: available && canAdminister,
    retry: false,
    // Another device can change these at any time, so a reopened page reads the host again.
    staleTime: 0,
  });

  /** Resolves true when the host saved the change. */
  async function save(current: Settings, input: Input): Promise<boolean> {
    if (pending.current) return false;
    pending.current = true;
    setSaving(true);
    setError(null);
    // A read that an `agents-changed` event started must not put the old value back after the save.
    await queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData<Settings | null>(queryKey, { ...current, ...input });
    try {
      const saved = await update({ ...input, agentId: agent.id }, agent.serverId);
      queryClient.setQueryData<Settings | null>(queryKey, saved);
      void haptics.notification("success");
      return true;
    } catch (cause) {
      queryClient.setQueryData<Settings | null>(queryKey, current);
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.agent.host.failed")));
      return false;
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  // A host without the capability answers null. A failed read keeps the controls hidden, as for a member.
  const current = canAdminister ? (settings.data ?? null) : null;
  return {
    current,
    enabled: available && !saving,
    failed: settings.isError,
    retry: () => void settings.refetch(),
    error,
    save,
  };
}

/** Computer Use, local scripts and the busy-message mode of an agent, from `agent-host-settings-v1`. */
function useAgentHostSettings(props: AgentHostFieldsProps) {
  const workspace = useMobileWorkspaceActions();
  return useAgentHostRecord<AgentHostSettings, Omit<UpdateAgentHostSettingsInput, "agentId">>(
    props,
    "host",
    workspace.loadAgentHostSettings,
    workspace.updateAgentHostSettings,
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
 * Agent info > Advanced: how many threads of the agent run at the same time. Only an owner or admin
 * sees it, and only when the host serves `agent-task-limit-v1`. It saves at once, as the fields above.
 */
export function AgentTaskLimitField(props: AgentHostFieldsProps) {
  const { t, format } = useText();
  const { theme } = useUniwind();
  const workspace = useMobileWorkspaceActions();
  const { current, enabled, error, save } = useAgentHostRecord<AgentTaskLimitSettings, AgentTaskLimitSettings>(
    props,
    "task-limit",
    workspace.loadAgentTaskLimit,
    workspace.updateAgentTaskLimit,
  );
  if (!current) return null;
  const { agent } = props;

  // A provider that runs one turn at a time runs one thread, whatever the limit.
  const oneTurnAtATime = agent.provider !== undefined && !agentProviderDescriptor(agent.provider).concurrentTurns;
  const choice: TaskLimitChoice = oneTurnAtATime ? 1 : (current.taskLimit ?? "default");
  return (
    <>
      <SettingsSection
        footer={
          oneTurnAtATime && agent.provider
            ? t("mobile.agent.taskLimit.oneTurn", { provider: agentProviderName(agent.provider) })
            : t("mobile.agent.taskLimit.footer")
        }
      >
        <SettingsRow
          trailing={
            <SettingsPicker<TaskLimitChoice>
              value={choice}
              options={TASK_LIMIT_CHOICES.map((value) => ({
                value,
                label:
                  value === "default"
                    ? t("mobile.agent.taskLimit.default", { count: AGENT_TASK_LIMIT_DEFAULT })
                    : format.number(value),
              }))}
              enabled={enabled && !oneTurnAtATime}
              dark={theme === "dark"}
              label={t("mobile.agent.taskLimit.footer")}
              onChange={(next) => {
                if (next !== choice) void save(current, { taskLimit: next === "default" ? null : next });
              }}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.agent.taskLimit.label")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SaveError error={error} />
    </>
  );
}

/**
 * Agent info > Advanced: whether the agent starts a new chat itself when its chat gets long, as on
 * desktop. Only an owner or admin sees it, and only when the host serves `agent-new-chat-v1`. A
 * change on desktop shows here while the page is open, and a change here shows on desktop at once.
 */
export function AgentNewChatAllowedField(props: AgentHostFieldsProps) {
  const { t } = useText();
  const { theme } = useUniwind();
  const workspace = useMobileWorkspaceActions();
  const { current, enabled, error, save } = useAgentHostRecord<AgentNewChatSettings, AgentNewChatSettings>(
    props,
    "new-chat",
    workspace.loadAgentNewChat,
    workspace.updateAgentNewChat,
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

/** Agent info > Advanced: whether the agent shows its plan before a long task, from `agent-plan-card-v1`. */
export function AgentPlanCardField(props: AgentHostFieldsProps) {
  const { t } = useText();
  const { theme } = useUniwind();
  const workspace = useMobileWorkspaceActions();
  const { current, enabled, error, save } = useAgentHostRecord<AgentPlanCardSettings, AgentPlanCardSettings>(
    props,
    "plan-card",
    workspace.loadAgentPlanCard,
    workspace.updateAgentPlanCard,
  );
  if (!current) return null;
  return (
    <>
      <SettingsSection footer={t("mobile.agent.planCard.footer")}>
        <SettingsRow>
          <SettingsSwitch
            value={current.quickAcknowledgement}
            disabled={!enabled}
            label={t("mobile.agent.planCard.label")}
            dark={theme === "dark"}
            onValueChange={(quickAcknowledgement) => void save(current, { quickAcknowledgement })}
          />
        </SettingsRow>
      </SettingsSection>
      <SaveError error={error} />
    </>
  );
}
