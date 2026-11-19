import { Typography } from "heroui-native";
import FoldVertical from "lucide-react-native/icons/fold-vertical";
import SquarePen from "lucide-react-native/icons/square-pen";
import Trash2 from "lucide-react-native/icons/trash";
import { useState } from "react";
import { Alert } from "react-native";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";
import type { MobileChannelStore } from "../model/channel-store";

type Action = "clear" | "compact" | "delete";

/**
 * "New conversation", "Compact context" and "Delete history" of a channel, as in the desktop channel
 * settings (`chat-history-v1`). Each member who sees the channel starts a new conversation or
 * compacts; only an owner or admin deletes the history. The host refuses while work of the channel
 * runs or waits, and its reason shows in the alert.
 */
export function ChannelContextActions({
  serverId,
  channelId,
  channelName,
  store,
  available,
  canDeleteHistory,
}: {
  serverId: string;
  channelId: string;
  channelName: string;
  store: MobileChannelStore;
  available: boolean;
  /** An owner or admin of the server. The host checks the role again. */
  canDeleteHistory: boolean;
}) {
  const { t } = useText();
  const [running, setRunning] = useState<Action | null>(null);
  // The host starts the compaction and answers; the members' providers finish it later.
  const [compactStarted, setCompactStarted] = useState(false);

  function run(action: Action): void {
    setRunning(action);
    if (action === "compact") setCompactStarted(false);
    const request =
      action === "clear"
        ? store.clearContext(serverId, channelId)
        : action === "compact"
          ? store.compactContext(serverId, channelId)
          : store.deleteHistory(serverId, channelId);
    request
      .then(() => {
        if (action === "compact") setCompactStarted(true);
        void haptics.notification("success");
      })
      .catch((cause: unknown) => {
        void haptics.notification("error");
        const text = currentText();
        const [title, body] =
          action === "clear"
            ? (["mobile.channel.newConversation.failed", "mobile.channel.newConversation.failedBody"] as const)
            : action === "compact"
              ? (["mobile.channel.compact.failed", "mobile.channel.compact.failedBody"] as const)
              : (["mobile.channel.deleteHistory.failed", "mobile.channel.deleteHistory.failedBody"] as const);
        showFailureAlert(cause, "team", text.t(title), text.errorMessage(cause, text.t(body)));
      })
      .finally(() => setRunning(null));
  }

  const disabled = !available || running !== null;
  return (
    <SettingsSection>
      <SettingsRow
        description={t("mobile.channel.newConversation.footer")}
        disabled={disabled}
        disclosure={false}
        leading={<RowIcon icon={SquarePen} tone="accent" />}
        onPress={() =>
          Alert.alert(
            t("mobile.channel.newConversation.confirmTitle", { name: channelName }),
            t("mobile.channel.newConversation.confirmBody"),
            [
              { text: t("common.cancel"), style: "cancel" },
              { text: t("mobile.channel.newConversation.confirm"), onPress: () => run("clear") },
            ],
          )
        }
      >
        <Typography.Paragraph className="text-accent">
          {t(running === "clear" ? "mobile.channel.newConversation.starting" : "mobile.channel.newConversation.title")}
        </Typography.Paragraph>
      </SettingsRow>
      <SettingsRow
        description={t(compactStarted ? "mobile.channel.compact.started" : "mobile.channel.compact.footer")}
        disabled={disabled}
        disclosure={false}
        leading={<RowIcon icon={FoldVertical} tone="accent" />}
        onPress={() => run("compact")}
      >
        <Typography.Paragraph className="text-accent">
          {t(running === "compact" ? "mobile.channel.compact.compacting" : "mobile.channel.compact.title")}
        </Typography.Paragraph>
      </SettingsRow>
      {canDeleteHistory ? (
        <SettingsRow
          description={t("mobile.channel.deleteHistory.footer")}
          disabled={disabled}
          disclosure={false}
          leading={<RowIcon icon={Trash2} tone="danger" />}
          onPress={() =>
            Alert.alert(
              t("mobile.channel.deleteHistory.confirmTitle", { name: channelName }),
              t("mobile.channel.deleteHistory.confirmBody"),
              [
                { text: t("common.cancel"), style: "cancel" },
                { text: t("mobile.channel.deleteHistory.confirm"), style: "destructive", onPress: () => run("delete") },
              ],
            )
          }
        >
          <Typography.Paragraph className="text-danger-text">
            {t(running === "delete" ? "mobile.channel.deleteHistory.deleting" : "mobile.channel.deleteHistory.title")}
          </Typography.Paragraph>
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
}
