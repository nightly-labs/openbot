import type { ConversationMemoryChange, ConversationMemoryChangeAction } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import BookmarkPlus from "lucide-react-native/icons/bookmark-plus";
import BookmarkX from "lucide-react-native/icons/bookmark-x";
import CircleSlash from "lucide-react-native/icons/circle-slash";
import Pencil from "lucide-react-native/icons/pencil";
import { View } from "react-native";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { useText } from "@/shared/lib/text";
import { memoryChangesSummary } from "../components/chat-memory-changes";
import { type SubagentColors, useSubagentColors } from "../components/chat-subagents";
import { firstParam, useConversationMessage } from "../components/use-conversation-message";

const NO_CHANGES: readonly ConversationMemoryChange[] = [];

const ACTION_LABELS = {
  saved: "mobile.chat.memory.action.saved",
  updated: "mobile.chat.memory.action.updated",
  forgotten: "mobile.chat.memory.action.forgotten",
  notChanged: "mobile.chat.memory.action.notChanged",
} as const satisfies Record<ConversationMemoryChangeAction, MobileTextKey>;

const ACTION_ICONS: Record<ConversationMemoryChangeAction, LucideIcon> = {
  saved: BookmarkPlus,
  updated: Pencil,
  forgotten: BookmarkX,
  notChanged: CircleSlash,
};

function actionColor(action: ConversationMemoryChangeAction, colors: SubagentColors): string {
  if (action === "saved") return colors.success;
  if (action === "notChanged") return colors.danger;
  return colors.muted;
}

/**
 * The memory changes of one turn: what the agent saved, updated and forgot, and what another thread
 * changed first.
 */
export function MemoryChangesScreen() {
  const text = useText();
  const { t } = text;
  const colors = useSubagentColors();
  const params = useLocalSearchParams<{ agentId: string; messageId: string }>();
  const agentId = firstParam(params.agentId) ?? "";
  const messageId = firstParam(params.messageId) ?? "";
  const changes = useConversationMessage(agentId, messageId)?.memoryChanges ?? NO_CHANGES;
  // One turn can change the same memory twice in the same way, so the key counts each repeat.
  const seen = new Map<string, number>();
  const keys = changes.map((change) => {
    const base = `${change.memoryId}:${change.action}`;
    const repeat = seen.get(base) ?? 0;
    seen.set(base, repeat + 1);
    return repeat === 0 ? base : `${base}:${repeat}`;
  });
  return (
    <SheetScrollView contentContainerClassName="gap-4 px-5 pb-safe-offset-8 pt-5" keyboardAware={false}>
      {changes.length > 0 ? (
        <Typography.Paragraph type="body-sm" style={{ color: colors.muted }}>
          {memoryChangesSummary(changes, text)}
        </Typography.Paragraph>
      ) : null}
      {changes.length > 0 ? (
        <View
          className="overflow-hidden rounded-[18px]"
          style={{ backgroundColor: colors.surface, borderCurve: "continuous" }}
        >
          {changes.map((change, index) => {
            const Icon = ACTION_ICONS[change.action];
            const color = actionColor(change.action, colors);
            return (
              <View key={keys[index]} className="flex-row gap-2.5 py-3 pl-3.5 pr-3.5">
                {index === 0 ? null : (
                  <View
                    className="absolute top-0 right-0"
                    style={{ left: 14 + 18 + 10, height: 0.5, backgroundColor: colors.border }}
                  />
                )}
                <View className="h-5 justify-center">
                  <Icon size={18} color={color} />
                </View>
                <View className="min-w-0 flex-1 gap-1">
                  <Typography.Paragraph type="body-xs" className="font-medium" style={{ color }}>
                    {t(ACTION_LABELS[change.action])}
                  </Typography.Paragraph>
                  {change.previousText ? (
                    <Typography.Paragraph
                      type="body-sm"
                      selectable
                      style={{ color: colors.dim, textDecorationLine: "line-through" }}
                    >
                      {change.previousText}
                    </Typography.Paragraph>
                  ) : null}
                  <Typography.Paragraph
                    type="body-sm"
                    selectable
                    style={{
                      color: change.action === "forgotten" ? colors.muted : colors.primary,
                      textDecorationLine: change.action === "forgotten" ? "line-through" : "none",
                    }}
                  >
                    {change.text}
                  </Typography.Paragraph>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </SheetScrollView>
  );
}
