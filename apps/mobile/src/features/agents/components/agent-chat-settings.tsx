import {
  type AgentNotificationLevelsSnapshot,
  agentNotificationLevelMap,
  type ServerNotificationLevel,
} from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Typography } from "heroui-native";
import { useState } from "react";
import { Alert } from "react-native";
import { useUniwind } from "uniwind";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { type MobileAgent, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

/**
 * The notifications switch of the agent settings. The host keeps one value for each agent, which
 * any member can change, and it applies to every member. A change saves at once, as on desktop.
 */
export function AgentNotificationsRow({ agent, available }: { agent: MobileAgent; available: boolean }) {
  const { t } = useText();
  const { updateAgent } = useMobileWorkspaceActions();
  const { theme } = useUniwind();
  // The requested value shows until the host answers, so the switch does not move back during the save.
  const [pending, setPending] = useState<boolean | null>(null);
  if (agent.notifications === undefined) return null;

  async function save(notifications: boolean): Promise<void> {
    setPending(notifications);
    try {
      await updateAgent({ agentId: agent.id, notifications }, agent.serverId);
      void haptics.notification("success");
    } catch (cause) {
      void haptics.notification("error");
      const text = currentText();
      showFailureAlert(
        cause,
        "agent",
        text.t("mobile.agent.notifications.failed"),
        text.errorMessage(cause, text.t("mobile.agent.notifications.failedBody")),
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <SettingsRow>
      <SettingsSwitch
        value={pending ?? agent.notifications}
        disabled={!available || pending !== null}
        label={t("mobile.agent.notifications.title")}
        dark={theme === "dark"}
        onValueChange={(next) => void save(next)}
      />
    </SettingsRow>
  );
}

/** "server" removes the user's own level, so the server level of each device applies again. */
type AgentNotificationChoice = "server" | ServerNotificationLevel;

const LEVEL_KEYS = {
  server: "mobile.agent.notificationLevel.server",
  all: "mobile.settings.notifications.level.all",
  "needs-me": "mobile.settings.notifications.level.needsMe",
  nothing: "mobile.settings.notifications.level.nothing",
} as const satisfies Record<AgentNotificationChoice, MobileTextKey>;

const LEVEL_CHOICES = ["server", "all", "needs-me", "nothing"] as const satisfies readonly AgentNotificationChoice[];

/**
 * The user's own notification level of the agent, on a host that serves `agent-notification-levels-v1`.
 * The host keeps it for this member only and applies it to the notifications of each of their
 * devices. The shared switch above stays: when it is off, no member gets notifications, so the
 * choice is disabled. A change saves at once, as the switch does.
 */
export function AgentNotificationLevelRow({ agent, available }: { agent: MobileAgent; available: boolean }) {
  const { t } = useText();
  const { loadAgentNotificationLevels, setAgentNotificationLevel } = useMobileWorkspaceActions();
  const { theme } = useUniwind();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.agentNotificationLevels(useQueryScope(), agent.serverId);
  const levels = useQuery({
    queryKey,
    queryFn: () => loadAgentNotificationLevels(agent.serverId),
    enabled: available,
    retry: false,
    // Another device of the user can change the levels, and no host event says so.
    staleTime: 0,
  });
  // The requested choice shows until the host answers. A failure shows the saved choice again.
  const [pending, setPending] = useState<AgentNotificationChoice | null>(null);
  const saved: AgentNotificationChoice | undefined = levels.data
    ? (agentNotificationLevelMap(levels.data).get(agent.id) ?? "server")
    : undefined;

  async function save(choice: AgentNotificationChoice): Promise<void> {
    if (choice === saved) return;
    setPending(choice);
    try {
      const snapshot = await setAgentNotificationLevel(
        { agentId: agent.id, level: choice === "server" ? null : choice },
        agent.serverId,
      );
      queryClient.setQueryData<AgentNotificationLevelsSnapshot>(queryKey, snapshot);
      void haptics.notification("success");
    } catch (cause) {
      void haptics.notification("error");
      const text = currentText();
      showFailureAlert(
        cause,
        "agent",
        text.t("mobile.agent.notifications.failed"),
        text.errorMessage(cause, text.t("mobile.agent.notifications.failedBody")),
      );
    } finally {
      setPending(null);
    }
  }

  const label = t("mobile.agent.notificationLevel.title");
  return (
    <SettingsRow
      trailing={
        <SettingsPicker<AgentNotificationChoice>
          value={pending ?? saved ?? "server"}
          options={LEVEL_CHOICES.map((choice) => ({ value: choice, label: t(LEVEL_KEYS[choice]) }))}
          enabled={available && saved !== undefined && pending === null && agent.notifications !== false}
          dark={theme === "dark"}
          label={label}
          onChange={(choice) => void save(choice)}
        />
      }
    >
      <Typography.Paragraph>{label}</Typography.Paragraph>
    </SettingsRow>
  );
}

/**
 * Starts a new chat with the agent after the user confirms, as on desktop. The agent forgets the
 * messages before it and keeps its setup. The host refuses while the agent works, and its reason
 * shows in the alert.
 */
export function AgentNewChatSection({ agent, available }: { agent: MobileAgent; available: boolean }) {
  const { t } = useText();
  const { startNewChat } = useMobileWorkspaceActions();
  const [starting, setStarting] = useState(false);

  function start(): void {
    setStarting(true);
    startNewChat(agent.id, agent.serverId)
      .then(() => {
        void haptics.notification("success");
      })
      .catch((cause: unknown) => {
        void haptics.notification("error");
        const text = currentText();
        showFailureAlert(
          cause,
          "agent",
          text.t("mobile.agent.newChat.failed"),
          text.errorMessage(cause, text.t("mobile.agent.newChat.failedBody")),
        );
      })
      .finally(() => setStarting(false));
  }

  return (
    <SettingsSection footer={t("mobile.agent.newChat.footer")}>
      <SettingsRow
        disabled={!available || starting}
        onPress={() =>
          Alert.alert(
            t("mobile.agent.newChat.confirmTitle", { name: agent.name }),
            t("mobile.agent.newChat.confirmBody"),
            [
              { text: t("common.cancel"), style: "cancel" },
              { text: t("mobile.agent.newChat.confirm"), onPress: start },
            ],
          )
        }
      >
        <Typography.Paragraph>
          {t(starting ? "mobile.agent.newChat.starting" : "mobile.agent.newChat.title")}
        </Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}
