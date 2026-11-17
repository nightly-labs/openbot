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
      leading={<RowIcon icon={Bell} />}
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
 * Puts an action row in its own section with `footer` under it, or, in a group of the Advanced page,
 * in a `SettingsGroupRow` with the text inside the row.
 */
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

/**
 * Starts a new chat with the agent after the user confirms, as on desktop. The agent forgets the
 * messages before it and keeps its setup. The host refuses while the agent works, and its reason
 * shows in the alert. `grouped`: a row of a group on the Advanced page.
 */
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

/**
 * Asks the host to compact the context of the agent's chat now, as "Compact now" on desktop. The
 * messages stay. The context ring of the composer shows the progress, on a host that reports it. The
 * host refuses while the agent works or when its provider cannot compact, and its reason shows in
 * the alert.
 */
export function AgentCompactSection({
  agent,
  available,
  taskId,
  compacting = false,
}: {
  agent: MobileAgent;
  available: boolean;
  /** A side thread of the agent, from the context sheet of its composer. Absent for the agent's own chat. */
  taskId?: string;
  /** The host reports a compaction that runs now: the row waits for it. */
  compacting?: boolean;
}) {
  const { t } = useText();
  const { compactContext } = useMobileWorkspaceActions();
  const [requesting, setRequesting] = useState(false);
  // The host starts the compaction and answers; the provider finishes it later.
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

/**
 * "Delete history" of the agent's own chat after the user confirms, as on desktop
 * (`chat-history-v1`). The messages and their files go, and the agent forgets them; side threads,
 * profile, memories and workspace stay. Only for a person with `manage` on the agent. The host
 * refuses while the agent works, and its reason shows in the alert. A row of a group on the
 * Advanced page.
 */
export function AgentDeleteHistoryRow({ agent, available }: { agent: MobileAgent; available: boolean }) {
  const { t } = useText();
  const { deleteAgentHistory, loadLatestMessages, conversationStore } = useMobileWorkspaceActions();
  const [deleting, setDeleting] = useState(false);

  function remove(): void {
    setDeleting(true);
    deleteAgentHistory(agent.id, agent.serverId)
      .then(() => {
        void haptics.notification("success");
        // A window around a search result keeps the messages that the empty latest page does not
        // name, so the chat reads its latest page again.
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
