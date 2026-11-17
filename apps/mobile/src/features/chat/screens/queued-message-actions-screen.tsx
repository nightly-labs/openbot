import type { AttachmentSummary, QueueDelivery } from "@openbot/contracts/ipc";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { StackActions } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowUpToLine from "lucide-react-native/icons/arrow-up-to-line";
import CornerDownRight from "lucide-react-native/icons/corner-down-right";
import ExternalLink from "lucide-react-native/icons/external-link";
import GitBranch from "lucide-react-native/icons/git-branch";
import Pencil from "lucide-react-native/icons/pencil";
import Trash2 from "lucide-react-native/icons/trash";
import { useState } from "react";
import { Alert } from "react-native";
import { useCSSVariable } from "uniwind";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { AttachmentThumbnail, showsAsImage, useAttachmentFile } from "../components/attachment-preview";
import { useQueuedChat } from "../context/queued-messages-context";
import { queuedMessageLocks, queuedMessagePreview } from "../model/queued-message-view";

/** The route name of a thread in the app stack, `app/(app)/task/[taskId].tsx`. */
const TASK_ROUTE = "task/[taskId]";

export function QueuedMessageActionsScreen() {
  const { t, format } = useText();
  const { chat, deliveryId } = useLocalSearchParams<{ chat: string; deliveryId: string }>();
  const { queue } = useQueuedChat(chat);
  // The stack inside the queued messages sheet. Its parent is the app stack, where the thread opens.
  const sheetStack = useNavigation().getParent();
  const foreground = useThemeColor("foreground");
  const danger = String(useCSSVariable("--openbot-danger-text"));
  const held = queue?.edit?.delivery ?? null;
  // A teammate's answer is not the user's message: steer is its only action.
  const reply = queue?.replies.find((item) => item.id === deliveryId);
  // The host takes the message out of the queue before it answers the move. The screen keeps it until
  // the new thread opens.
  const [moving, setMoving] = useState<QueueDelivery | null>(null);
  const delivery =
    (held?.id === deliveryId ? held : (queue?.queued.find((item) => item.id === deliveryId) ?? reply)) ?? moving;

  if (!queue || !delivery) {
    return (
      <SettingsContent>
        <Typography.Paragraph align="center" className="text-text-secondary">
          {t("mobile.chat.queue.noLongerQueued")}
        </Typography.Paragraph>
      </SettingsContent>
    );
  }

  const { locked, editedElsewhere, heldForEdit } = queuedMessageLocks(delivery, {
    busy: queue.busy,
    online: queue.online,
    held,
  });
  const head = queue.queued[0];
  const headEdited = Boolean(head && head.id !== delivery.id && (head.editing || held?.id === head.id));
  const finish = (action: Promise<boolean>) => {
    void action.then((done) => {
      void haptics.notification(done ? "success" : "error");
      if (done) router.back();
    });
  };

  // As on desktop's "Run in new thread": the message leaves the queue, starts in a new thread, and the
  // thread opens in place of this sheet.
  const runAsThread = () => {
    setMoving(delivery);
    void queue.runAsThread(delivery).then((task) => {
      void haptics.notification(task ? "success" : "error");
      if (!task) {
        setMoving(null);
        return;
      }
      sheetStack?.dispatch(
        StackActions.replace(TASK_ROUTE, { taskId: task.id, agentId: task.agentId, serverId: queue.serverId }),
      );
    });
  };

  return (
    <SettingsContent>
      <SettingsSection
        title={t("mobile.chat.queue.position", {
          position: delivery.position ?? "–",
          date: formatUpdatedAt(delivery.createdAt, format),
        })}
      >
        <SettingsRow>
          <Typography>{queuedMessagePreview(delivery)}</Typography>
        </SettingsRow>
      </SettingsSection>

      {delivery.attachments.length > 0 ? (
        <SettingsSection title={t("mobile.chat.queue.attachments")}>
          {delivery.attachments.map((file) => (
            <QueuedAttachmentRow key={file.id} attachment={file} serverId={queue.serverId} />
          ))}
        </SettingsSection>
      ) : null}

      <SettingsSection>
        {reply ? null : (
          <SettingsRow
            leading={<Pencil color={foreground} size={22} />}
            disabled={locked || editedElsewhere || !queue.canEdit}
            onPress={() =>
              router.push({ pathname: "/queued-messages/edit", params: { chat, deliveryId: delivery.id } })
            }
          >
            <Typography>{t("common.edit")}</Typography>
          </SettingsRow>
        )}
        {/* As on desktop, an agent that cannot steer offers Send now. An answer has no Send now. */}
        {queue.steers || !reply ? (
          <SettingsRow
            leading={<CornerDownRight color={foreground} size={22} style={MIRROR_IN_RTL} />}
            disclosure={false}
            // As on desktop, Send now waits while another message that is first is being edited: an
            // edited message keeps its place, and the queue starts nothing while it is first.
            disabled={
              locked || editedElsewhere || !queue.activeTurnId || queue.steerRefused || (!queue.steers && headEdited)
            }
            onPress={() => finish(queue.steers ? queue.steer(delivery) : queue.sendNow(delivery))}
          >
            <Typography>{t(queue.steers ? "mobile.chat.queue.steer" : "mobile.chat.queue.sendNow")}</Typography>
          </SettingsRow>
        ) : null}
        {reply ? null : (
          <SettingsRow
            leading={<ArrowUpToLine color={foreground} size={22} />}
            disclosure={false}
            disabled={locked || editedElsewhere || delivery.position === 1}
            onPress={() => finish(queue.moveFirst(delivery))}
          >
            <Typography>{t("mobile.chat.queue.moveFirst")}</Typography>
          </SettingsRow>
        )}
        {reply || !queue.canRunAsThread ? null : (
          <SettingsRow
            leading={<GitBranch color={foreground} size={22} />}
            disclosure={false}
            disabled={locked || editedElsewhere || heldForEdit || moving !== null}
            onPress={runAsThread}
          >
            <Typography>{t("mobile.chat.queue.runInNewThread")}</Typography>
          </SettingsRow>
        )}
      </SettingsSection>

      {reply ? null : (
        <SettingsSection>
          <SettingsRow
            leading={<Trash2 color={danger} size={22} />}
            disclosure={false}
            disabled={locked}
            onPress={() =>
              Alert.alert(t("mobile.chat.queue.deleteTitle"), t("mobile.chat.queue.deleteMessage"), [
                { text: t("mobile.chat.queue.keep"), style: "cancel" },
                { text: t("common.delete"), style: "destructive", onPress: () => finish(queue.remove(delivery)) },
              ])
            }
          >
            <Typography className="text-danger-text">{t("common.delete")}</Typography>
          </SettingsRow>
        </SettingsSection>
      )}

      {editedElsewhere ? <SettingsNote>{t("mobile.chat.queue.editedElsewhere")}</SettingsNote> : null}
      {queue.activeTurnId ? null : (
        <SettingsNote>
          {t(queue.steers ? "mobile.chat.queue.steerNeedsTurn" : "mobile.chat.queue.sendNowNeedsTurn")}
        </SettingsNote>
      )}
      {queue.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text">
          {queue.error}
        </Typography.Paragraph>
      ) : null}
    </SettingsContent>
  );
}

/** A queued file: an image shows its own thumbnail, and every file opens in the share sheet. */
function QueuedAttachmentRow({ attachment, serverId }: { attachment: AttachmentSummary; serverId: string }) {
  const { t, format } = useText();
  const muted = useThemeColor("muted");
  const image = showsAsImage(attachment);
  const file = useAttachmentFile(serverId, attachment, image);
  return (
    <SettingsRow
      disclosure={false}
      leading={<AttachmentThumbnail name={attachment.name} uri={image ? file.uri : null} />}
      supportingText={file.busy ? t("mobile.chat.attachment.downloading") : format.fileSize(attachment.size)}
      trailing={<ExternalLink size={18} color={String(muted)} />}
      onPress={file.share}
    >
      <Typography numberOfLines={1}>{attachment.name}</Typography>
    </SettingsRow>
  );
}
