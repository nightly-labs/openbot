import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ChevronUp, Clock } from "lucide-react-native";
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
  if (count === 0) return null;
  return (
    <View className="mb-2 items-center">
      <ChatGlassButton
        accessibilityLabel={`${count} queued message${count === 1 ? "" : "s"}. Show queued messages`}
        className="h-11 flex-row items-center gap-2 px-4"
        fallbackBackground={fallbackBackground}
        height={44}
        liquidGlassAvailable={liquidGlassAvailable}
        onPress={() => {
          void haptics.selection();
          router.push("/queued-messages");
        }}
      >
        <Clock color={String(muted)} size={16} strokeWidth={2} />
        <Typography.Paragraph type="body-sm" weight="semibold">
          {count} queued
        </Typography.Paragraph>
        <ChevronUp color={String(muted)} size={16} strokeWidth={2} />
      </ChatGlassButton>
    </View>
  );
});
