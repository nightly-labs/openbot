import { agentNotificationLevelMap } from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useAgentNewChat } from "@/features/agents/components/use-agent-new-chat";
import { NOTIFICATION_LEVEL_KEYS } from "@/features/push-notifications/components/server-notification-settings";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { effectiveServerLevel, useSyncedNotificationLevels } from "@/features/settings/model/notification-levels";
import { serverNotificationSetting, usePushNotificationPreference } from "@/features/settings/model/push-notifications";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
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

export function AgentNewChatSection({ agent, available }: { agent: MobileAgent; available: boolean }) {
  const { t } = useText();
  const { starting, confirmNewChat } = useAgentNewChat(agent);

  return (
    <SettingsSection footer={t("mobile.agent.newChat.footer")}>
      <SettingsRow disabled={!available || starting} onPress={confirmNewChat}>
        <Typography.Paragraph>
          {t(starting ? "mobile.agent.newChat.starting" : "mobile.agent.newChat.title")}
        </Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}
