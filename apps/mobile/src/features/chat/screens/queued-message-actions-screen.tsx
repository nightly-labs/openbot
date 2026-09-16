import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ArrowUpToLine, CornerDownRight, FileText, Pencil, Trash2 } from "lucide-react-native";
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
import { useQueuedMessages } from "../context/queued-messages-context";
import { queuedMessagePreview } from "../model/queued-message-view";

export function QueuedMessageActionsScreen() {
  const { deliveryId } = useLocalSearchParams<{ deliveryId: string }>();
  const { queue } = useQueuedMessages();
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

  // Editing holds one delivery on the host. Leave the other rows read-only until it ends.
  const locked = queue.busy || !queue.online || Boolean(held && held.id !== delivery.id);
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
        {delivery.attachments.map((file) => (
          <SettingsRow key={file.id} leading={<FileText color={foreground} size={22} />}>
            <Typography numberOfLines={1}>{file.name}</Typography>
          </SettingsRow>
        ))}
      </SettingsSection>

      <SettingsSection>
        <SettingsRow
          leading={<Pencil color={foreground} size={22} />}
          disabled={locked || !queue.canEdit}
          onPress={() => {
            void haptics.selection();
            router.push({ pathname: "/queued-messages/edit", params: { deliveryId: delivery.id } });
          }}
        >
          <Typography>Edit</Typography>
        </SettingsRow>
        <SettingsRow
          leading={<CornerDownRight color={foreground} size={22} />}
          disclosure={false}
          disabled={locked || !queue.activeTurnId}
          onPress={() => finish(queue.steer(delivery))}
        >
          <Typography>Steer</Typography>
        </SettingsRow>
        <SettingsRow
          leading={<ArrowUpToLine color={foreground} size={22} />}
          disclosure={false}
          disabled={locked || delivery.position === 1}
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

      {queue.activeTurnId ? null : <SettingsNote>Steer needs a running turn.</SettingsNote>}
      {queue.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text">
          {queue.error}
        </Typography.Paragraph>
      ) : null}
    </SettingsContent>
  );
}
