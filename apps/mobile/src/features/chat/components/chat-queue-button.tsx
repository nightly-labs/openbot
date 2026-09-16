import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ChevronUp, Clock, TriangleAlert } from "lucide-react-native";
import { memo } from "react";
import { View, type ViewStyle } from "react-native";
import { haptics } from "@/shared/lib/haptics";
import type { QueuedUpload } from "../context/queued-messages-context";
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
  const muted = useThemeColor("muted");
  const count = queue.queued.length + (pending ? 1 : 0);
  // A queue that failed to load reports no messages. Keep the entry, so the failure and its
  // retry stay reachable instead of leaving the chat with nothing to press.
  const failed = count === 0 && Boolean(queue.error);
  if (count === 0 && !failed) return null;
  return (
    <View className="mb-2 items-center">
      <ChatGlassButton
        accessibilityLabel={
          failed
            ? "The queued messages did not load. Show queued messages"
            : `${count} queued message${count === 1 ? "" : "s"}. Show queued messages`
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
          {failed ? "Queue unavailable" : `${count} queued`}
        </Typography.Paragraph>
        <ChevronUp color={String(muted)} size={16} strokeWidth={2} />
      </ChatGlassButton>
    </View>
  );
});
