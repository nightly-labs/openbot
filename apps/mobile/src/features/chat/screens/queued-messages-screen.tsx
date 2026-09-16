import type { QueueDelivery } from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { Button, Typography } from "heroui-native";
import { X } from "lucide-react-native";
import { useMemo } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { haptics } from "@/shared/lib/haptics";
import { type QueuedUpload, useQueuedMessages } from "../context/queued-messages-context";
import { queueRowsWithHeldEdit } from "../model/queue-edit-draft";
import { queuedMessagePreview } from "../model/queued-message-view";

function QueuePosition({ label }: { label: string }) {
  return (
    <View className="size-7 items-center justify-center rounded-full bg-control">
      <Typography type="body-xs" weight="semibold">
        {label}
      </Typography>
    </View>
  );
}

function UploadRow({ pending }: { pending: QueuedUpload }) {
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const uploading = pending.total > 0 && pending.progress < pending.total;
  return (
    <SettingsRow
      leading={<QueuePosition label="…" />}
      supportingText={uploading ? `Uploading ${pending.progress} of ${pending.total}` : undefined}
      trailing={
        uploading ? (
          <Button isIconOnly variant="ghost" accessibilityLabel="Cancel queued upload" onPress={pending.cancel}>
            <X color={muted} size={18} />
          </Button>
        ) : null
      }
    >
      <Typography numberOfLines={2}>
        {pending.message.body || pending.message.attachments?.map((file) => file.name).join(", ")}
      </Typography>
    </SettingsRow>
  );
}

export function QueuedMessagesScreen() {
  const { queue, pending } = useQueuedMessages();
  const queued = queue?.queued;
  const held = queue?.edit?.delivery ?? null;
  const rows = useMemo(() => queueRowsWithHeldEdit(queued ?? [], held), [queued, held]);
  const count = rows.length + (pending ? 1 : 0);
  const open = (delivery: QueueDelivery) => {
    void haptics.selection();
    router.push({ pathname: "/queued-messages/actions", params: { deliveryId: delivery.id } });
  };
  return (
    <SettingsContent>
      {queue?.error ? (
        <>
          <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text">
            {queue.error}
          </Typography.Paragraph>
          <SettingsSection>
            <SettingsRow
              disclosure={false}
              disabled={queue.busy || queue.loading}
              onPress={() => {
                void haptics.selection();
                queue.refresh();
              }}
            >
              <Typography>Try again</Typography>
            </SettingsRow>
          </SettingsSection>
        </>
      ) : null}
      {count > 0 ? (
        <SettingsSection title="Waiting for the agent">
          {pending ? <UploadRow pending={pending} /> : null}
          {rows.map((item) => (
            <SettingsRow
              key={item.id}
              leading={<QueuePosition label={String(item.position ?? "–")} />}
              supportingText={item.editing || held?.id === item.id ? "Editing" : formatUpdatedAt(item.createdAt)}
              onPress={() => open(item)}
            >
              <Typography numberOfLines={2}>{queuedMessagePreview(item)}</Typography>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
      {count === 0 && queue?.loading ? (
        <Typography.Paragraph align="center" className="text-text-secondary">
          Loading the queue…
        </Typography.Paragraph>
      ) : null}
      {count === 0 && !queue?.loading ? (
        <View className="items-center px-8 py-12">
          <Typography.Paragraph align="center" weight="semibold">
            No queued messages
          </Typography.Paragraph>
          <Typography.Paragraph type="body-xs" align="center" className="mt-1 text-text-secondary">
            New messages join the queue while the agent works.
          </Typography.Paragraph>
        </View>
      ) : null}
    </SettingsContent>
  );
}
