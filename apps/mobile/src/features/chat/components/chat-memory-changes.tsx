import { type ConversationMemoryChange, countConversationMemoryChanges } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import Brain from "lucide-react-native/icons/brain";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import { Pressable } from "react-native";
import type { ChatMessage } from "@/features/chat/model/chat-messages";
import { haptics } from "@/shared/lib/haptics";
import type { MobileText } from "@/shared/lib/text";
import { useText } from "@/shared/lib/text";
import { useSubagentColors } from "./chat-subagents";

type MemoryChangesMessage = Extract<ChatMessage, { kind: "memory-changes" }>;

/** "Memory: 2 saved and 1 forgotten", as the steps summary on desktop counts the changes. */
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

/**
 * The memory changes that one turn committed, in one line, as the subagents line shows its group.
 * The line opens the sheet with each change.
 */
export function ChatMemoryChanges({
  message,
  onOpen,
}: {
  message: MemoryChangesMessage;
  /** Absent where no sheet can show the changes. */
  onOpen: ((messageId: string) => void) | undefined;
}) {
  const text = useText();
  const colors = useSubagentColors();
  const summary = memoryChangesSummary(message.changes, text);
  return (
    <Pressable
      accessibilityRole={onOpen ? "button" : undefined}
      accessibilityLabel={summary}
      disabled={!onOpen}
      onPress={
        onOpen
          ? () => {
              void haptics.selection();
              onOpen(message.id);
            }
          : undefined
      }
      className="flex-row items-center gap-2 self-start px-1"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Brain size={16} color={colors.muted} />
      <Typography.Paragraph type="body-sm" numberOfLines={1} className="shrink" style={{ color: colors.muted }}>
        {summary}
      </Typography.Paragraph>
      {onOpen ? <ChevronRight size={16} color={colors.dim} /> : null}
    </Pressable>
  );
}
