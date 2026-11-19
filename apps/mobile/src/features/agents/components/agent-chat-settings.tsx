import { agentNotificationLevelMap } from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import Bell from "lucide-react-native/icons/bell";
import FoldVertical from "lucide-react-native/icons/fold-vertical";
import SquarePen from "lucide-react-native/icons/square-pen";
import Trash2 from "lucide-react-native/icons/trash";
import { type ReactNode, useState } from "react";
import { Alert } from "react-native";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { NOTIFICATION_LEVEL_KEYS } from "@/features/push-notifications/components/server-notification-settings";
import { SettingsGroupRow, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { effectiveServerLevel, useSyncedNotificationLevels } from "@/features/settings/model/notification-levels";
import { serverNotificationSetting, usePushNotificationPreference } from "@/features/settings/model/push-notifications";
import { type MobileAgent, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

export function AgentNotificationLevelRow({ agent }: { agent: MobileAgent }) {
  const { t } = useText();
  const preference = usePushNotificationPreference();
  const synced = useSyncedNotificationLevels((state) => state.servers[agent.serverId]);
  const own = synced ? agentNotificationLevelMap(synced).get(agent.id) : undefined;
  const serverLevel = effectiveServerLevel(synced, serverNotificationSetting(preference, agent.serverId));
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
      leading={<RowIcon icon={Bell} />}
      supportingText={value}
      onPress={() =>
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

function ActionRowFrame({
  grouped,
  footer,
  children,
}: {
  grouped: boolean;
  footer: string;
  children: (description: string | undefined) => ReactNode;
}) {
  return grouped ? (
    <SettingsGroupRow>{children(footer)}</SettingsGroupRow>
  ) : (
    <SettingsSection footer={footer}>{children(undefined)}</SettingsSection>
  );
}

export function AgentNewChatSection({
  agent,
  available,
  grouped = false,
}: {
  agent: MobileAgent;
  available: boolean;
  grouped?: boolean;
}) {
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
    <ActionRowFrame grouped={grouped} footer={t("mobile.agent.newChat.footer")}>
      {(description) => (
        <SettingsRow
          description={description}
          disabled={!available || starting}
          disclosure={false}
          leading={<RowIcon icon={SquarePen} tone="accent" />}
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
          <Typography.Paragraph className="text-accent">
            {t(starting ? "mobile.agent.newChat.starting" : "mobile.agent.newChat.title")}
          </Typography.Paragraph>
        </SettingsRow>
      )}
    </ActionRowFrame>
  );
}

export function AgentCompactSection({
  agent,
  available,
  taskId,
  compacting = false,
}: {
  agent: MobileAgent;
  available: boolean;
  taskId?: string;
  compacting?: boolean;
}) {
  const { t } = useText();
  const { compactContext } = useMobileWorkspaceActions();
  const [requesting, setRequesting] = useState(false);
  const [started, setStarted] = useState(false);

  function compact(): void {
    setRequesting(true);
    setStarted(false);
    compactContext(agent.id, agent.serverId, taskId)
      .then(() => {
        setStarted(true);
        void haptics.notification("success");
      })
      .catch((cause: unknown) => {
        void haptics.notification("error");
        const text = currentText();
        showFailureAlert(
          cause,
          "agent",
          text.t("mobile.agent.compact.failed"),
          text.errorMessage(cause, text.t("mobile.agent.compact.failedBody")),
        );
      })
      .finally(() => setRequesting(false));
  }

  return (
    <SettingsSection footer={t(started ? "mobile.agent.compact.started" : "mobile.agent.compact.footer")}>
      <SettingsRow
        disabled={!available || requesting || compacting}
        disclosure={false}
        leading={<RowIcon icon={FoldVertical} tone="accent" />}
        onPress={compact}
      >
        <Typography.Paragraph className="text-accent">
          {t(
            compacting
              ? "mobile.chat.context.labelCompacting"
              : requesting
                ? "mobile.agent.compact.compacting"
                : "mobile.agent.compact.title",
          )}
        </Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

export function AgentDeleteHistoryRow({ agent, available }: { agent: MobileAgent; available: boolean }) {
  const { t } = useText();
  const { deleteAgentHistory, loadLatestMessages, conversationStore } = useMobileWorkspaceActions();
  const [deleting, setDeleting] = useState(false);

  function remove(): void {
    setDeleting(true);
    deleteAgentHistory(agent.id, agent.serverId)
      .then(() => {
        void haptics.notification("success");
        if (conversationStore.get(agent.id)) void loadLatestMessages(agent.id, agent.serverId).catch(() => undefined);
      })
      .catch((cause: unknown) => {
        void haptics.notification("error");
        const text = currentText();
        showFailureAlert(
          cause,
          "agent",
          text.t("mobile.agent.deleteHistory.failed"),
          text.errorMessage(cause, text.t("mobile.agent.deleteHistory.failedBody")),
        );
      })
      .finally(() => setDeleting(false));
  }

  return (
    <SettingsGroupRow>
      <SettingsRow
        description={t("mobile.agent.deleteHistory.footer")}
        disabled={!available || deleting}
        disclosure={false}
        leading={<RowIcon icon={Trash2} tone="danger" />}
        onPress={() =>
          Alert.alert(
            t("mobile.agent.deleteHistory.confirmTitle", { name: agent.name }),
            t("mobile.agent.deleteHistory.confirmBody"),
            [
              { text: t("common.cancel"), style: "cancel" },
              { text: t("mobile.agent.deleteHistory.confirm"), style: "destructive", onPress: remove },
            ],
          )
        }
      >
        <Typography.Paragraph className="text-danger-text">
          {t(deleting ? "mobile.agent.deleteHistory.deleting" : "mobile.agent.deleteHistory.title")}
        </Typography.Paragraph>
      </SettingsRow>
    </SettingsGroupRow>
  );
}
