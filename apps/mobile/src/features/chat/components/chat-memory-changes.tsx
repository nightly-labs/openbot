import { type ConversationMemoryChange, countConversationMemoryChanges } from "@openbot/contracts/ipc";
import Bookmark from "lucide-react-native/icons/bookmark";
import type { ChatMessage } from "@/features/chat/model/chat-messages";
import type { MobileText } from "@/shared/lib/text";
import { useText } from "@/shared/lib/text";
import { ACTIVITY_ICON_SIZE, ChatActivityLine, useActivityColors } from "./chat-activity-line";

type MemoryChangesMessage = Extract<ChatMessage, { kind: "memory-changes" }>;

export function memoryChangesSummary(
  changes: readonly ConversationMemoryChange[],
  { t, format }: Pick<MobileText, "t" | "format">,
): string {
  const counts = countConversationMemoryChanges(changes);
  const parts = [
    counts.saved ? t("mobile.chat.memory.count.saved", { count: counts.saved }) : null,
    counts.updated ? t("mobile.chat.memory.count.updated", { count: counts.updated }) : null,
    counts.forgotten ? t("mobile.chat.memory.count.forgotten", { count: counts.forgotten }) : null,
    counts.notChanged ? t("mobile.chat.memory.count.notChanged", { count: counts.notChanged }) : null,
  ].filter((part): part is string => part !== null);
  return t("mobile.chat.memory.summary", { changes: format.list(parts) });
}

export function ChatMemoryChanges({
  message,
  onOpen,
}: {
  message: MemoryChangesMessage;
  onOpen: ((messageId: string) => void) | undefined;
}) {
  const text = useText();
  const colors = useActivityColors();
  const summary = memoryChangesSummary(message.changes, text);
  return (
    <ChatActivityLine
      icon={<Bookmark size={ACTIVITY_ICON_SIZE} color={colors.muted} />}
      label={summary}
      accessibilityLabel={summary}
      onPress={onOpen ? () => onOpen(message.id) : undefined}
    />
  );
}
