import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ArrowUpToLine, CornerDownRight, ExternalLink, Pencil, Trash2 } from "lucide-react-native";
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
import { AttachmentThumbnail, formatFileSize, useAttachmentFile } from "../components/attachment-preview";
import { useQueuedChat } from "../context/queued-messages-context";
import { queuedMessagePreview } from "../model/queued-message-view";

export function QueuedMessageActionsScreen() {
  const { chat, deliveryId } = useLocalSearchParams<{ chat: string; deliveryId: string }>();
  const { queue } = useQueuedChat(chat);
  const foreground = useThemeColor("foreground");
  const danger = String(useCSSVariable("--openbot-danger-text"));
  const held = queue?.edit?.delivery ?? null;
  const delivery = held?.id === deliveryId ? held : queue?.queued.find((item) => item.id === deliveryId);

  if (!queue || !delivery) {
    return (
      <SettingsContent>
        <Typography.Paragraph align="center" className="text-text-secondary">
          This message is no longer queued.
        </Typography.Paragraph>
      </SettingsContent>
    );
  }

  // Editing holds one delivery on the host: our own hold locks every other row until it ends.
  const locked = queue.busy || !queue.online || Boolean(held && held.id !== delivery.id);
  // Another device holds this one. Only confirmed deletion remains available.
  const editedElsewhere = Boolean(delivery.editing) && held?.id !== delivery.id;
  const finish = (action: Promise<boolean>) => {
    void haptics.impact();
    void action.then((done) => {
      void haptics.notification(done ? "success" : "error");
      if (done) router.back();
    });
  };

  return (
    <SettingsContent>
      <SettingsSection title={`Position ${delivery.position ?? "–"} · ${formatUpdatedAt(delivery.createdAt)}`}>
        <SettingsRow>
          <Typography>{queuedMessagePreview(delivery)}</Typography>
        </SettingsRow>
      </SettingsSection>

      {delivery.attachments.length > 0 ? (
        <SettingsSection title="Attachments">
          {delivery.attachments.map((file) => (
            <QueuedAttachmentRow key={file.id} attachment={file} serverId={queue.serverId} />
          ))}
        </SettingsSection>
      ) : null}

      <SettingsSection>
        <SettingsRow
          leading={<Pencil color={foreground} size={22} />}
          disabled={locked || editedElsewhere || !queue.canEdit}
          onPress={() => {
            void haptics.selection();
            router.push({ pathname: "/queued-messages/edit", params: { chat, deliveryId: delivery.id } });
          }}
        >
          <Typography>Edit</Typography>
        </SettingsRow>
        <SettingsRow
          leading={<CornerDownRight color={foreground} size={22} />}
          disclosure={false}
          disabled={locked || editedElsewhere || !queue.activeTurnId}
          onPress={() => finish(queue.steer(delivery))}
        >
          <Typography>Steer</Typography>
        </SettingsRow>
        <SettingsRow
          leading={<ArrowUpToLine color={foreground} size={22} />}
          disclosure={false}
          disabled={locked || editedElsewhere || delivery.position === 1}
          onPress={() => finish(queue.moveFirst(delivery))}
        >
          <Typography>Move to first</Typography>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection>
        <SettingsRow
          leading={<Trash2 color={danger} size={22} />}
          disclosure={false}
          disabled={locked}
          onPress={() =>
            Alert.alert("Delete queued message?", "The agent never receives it.", [
              { text: "Keep", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => finish(queue.remove(delivery)) },
            ])
          }
        >
          <Typography className="text-danger-text">Delete</Typography>
        </SettingsRow>
      </SettingsSection>

      {editedElsewhere ? <SettingsNote>Another device is editing this message.</SettingsNote> : null}
      {queue.activeTurnId ? null : <SettingsNote>Steer needs a running turn.</SettingsNote>}
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
  const muted = useThemeColor("muted");
  const image = attachment.kind === "image";
  const file = useAttachmentFile(serverId, attachment, image);
  return (
    <SettingsRow
      disclosure={false}
      leading={<AttachmentThumbnail name={attachment.name} uri={image ? file.uri : null} />}
      supportingText={file.busy ? "Downloading…" : formatFileSize(attachment.size)}
      trailing={<ExternalLink size={18} color={String(muted)} />}
      onPress={file.share}
    >
      <Typography numberOfLines={1}>{attachment.name}</Typography>
    </SettingsRow>
  );
}
