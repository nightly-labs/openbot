import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ChevronUp, Clock, TriangleAlert } from "lucide-react-native";
import { memo } from "react";
import { View, type ViewStyle } from "react-native";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import type { QueuedUpload } from "../context/queued-messages-context";
import { queueRowsWithHeldEdit } from "../model/queue-edit-draft";
import { ChatGlassButton } from "./chat-glass-icon-button";
import type { ChatQueueController } from "./use-chat-queue";

interface ChatQueueButtonProps {
  queue: ChatQueueController;
  pending?: QueuedUpload | null;
  liquidGlassAvailable: boolean;
  fallbackBackground: ViewStyle["backgroundColor"];
}

export const ChatQueueButton = memo(function ChatQueueButton({
  queue,
  pending,
  liquidGlassAvailable,
  fallbackBackground,
}: ChatQueueButtonProps) {
  const { t } = useText();
  const muted = useThemeColor("muted");
  // The sheet keeps a held edit in its rows when the host hides it. Count it here as
  // well, so a saved edit with a lost response stays reachable after a restart.
  const rows = queueRowsWithHeldEdit(queue.queued, queue.edit?.delivery ?? null);
  const count = rows.length + (pending ? 1 : 0);
  // A queue that failed to load reports no messages. Keep the entry, so the failure and its
  // retry stay reachable instead of leaving the chat with nothing to press.
  const failed = count === 0 && Boolean(queue.error);
  if (count === 0 && !failed) return null;
  return (
    <View className="mb-2 items-center">
      <ChatGlassButton
        accessibilityLabel={
          failed ? t("mobile.chat.queue.buttonFailed") : t("mobile.chat.queue.buttonLabel", { count })
        }
        className="h-11 flex-row items-center gap-2 px-4"
        fallbackBackground={fallbackBackground}
        height={44}
        liquidGlassAvailable={liquidGlassAvailable}
        onPress={() => {
          void haptics.selection();
          router.push({ pathname: "/queued-messages", params: { chat: queue.chatId } });
        }}
      >
        {failed ? (
          <TriangleAlert color={String(muted)} size={16} strokeWidth={2} />
        ) : (
          <Clock color={String(muted)} size={16} strokeWidth={2} />
        )}
        <Typography.Paragraph type="body-sm" weight="semibold">
          {failed ? t("mobile.chat.queue.unavailable") : t("mobile.chat.queue.count", { count })}
        </Typography.Paragraph>
        <ChevronUp color={String(muted)} size={16} strokeWidth={2} />
      </ChatGlassButton>
    </View>
  );
});
