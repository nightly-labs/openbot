import { agentNotificationLevelMap } from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useState } from "react";
import { Alert } from "react-native";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { NOTIFICATION_LEVEL_KEYS } from "@/features/push-notifications/components/server-notification-settings";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { effectiveServerLevel, useSyncedNotificationLevels } from "@/features/settings/model/notification-levels";
import { serverNotificationSetting, usePushNotificationPreference } from "@/features/settings/model/push-notifications";
import { type MobileAgent, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

/**
 * The user's own notification level of the agent, on a host that serves `agent-notification-levels-v1`.
 * The host keeps it for this member only and applies it on each of their devices. Settings >
 * Notifications is the one place that changes it, so the row opens that screen in the agent sheet,
 * with the agent's server and the agent selected.
 */
export function AgentNotificationLevelRow({ agent }: { agent: MobileAgent }) {
  const { t } = useText();
  const preference = usePushNotificationPreference();
  const synced = useSyncedNotificationLevels((state) => state.servers[agent.serverId]);
  const own = synced ? agentNotificationLevelMap(synced).get(agent.id) : undefined;
  const serverLevel = effectiveServerLevel(synced, serverNotificationSetting(preference, agent.serverId));
  // Until the host answers, the row shows no level: the agent can have a level of its own.
  const value =
    synced === undefined
      ? undefined
      : agent.notifications === false
        ? t("mobile.settings.notifications.offForEveryone")
        : own
          ? t(NOTIFICATION_LEVEL_KEYS[own])
          : t("mobile.agent.notificationLevel.serverValue", { level: t(NOTIFICATION_LEVEL_KEYS[serverLevel]) });
  return (
    <SettingsRow
      supportingText={value}
      onPress={() =>
        // The agent sheet shows Settings > Notifications in its own stack, not as a second sheet.
        router.push({
          pathname: "/agent-info/[agentId]/notifications",
          params: { agentId: agent.id, serverId: agent.serverId },
        })
      }
    >
      <Typography.Paragraph>{t("mobile.agent.notificationLevel.title")}</Typography.Paragraph>
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
