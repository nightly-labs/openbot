import type { ConversationReaction } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";
import { type MessageChannelTargets, type MessageFiles, openMessageActions } from "../model/message-actions-sheet";

export interface MessageActionsInput {
  messageId: string;
  copyText: () => string;
  createdAt?: string;
  reactions?: readonly ConversationReaction[];
  onReact?: (emoji: string | null) => Promise<void>;
  onReply?: () => void;
  onBranch?: () => void;
  onSelectText?: () => void;
  readAloudId?: string;
  sendToChannel?: MessageChannelTargets;
  onDelete?: () => Promise<void>;
  onMarkUnread?: () => void;
  pinned?: boolean;
  onTogglePin?: () => Promise<void>;
  files?: MessageFiles;
}

export function reportTeamResult(work: Promise<void>, failedTitle: MobileTextKey): Promise<void> {
  return work.then(
    () => void haptics.notification("success"),
    (error: unknown) => {
      void haptics.notification("error");
      const title = currentText().t(failedTitle);
      showFailureAlert(error, "team", title, currentText().errorMessage(error, title));
    },
  );
}

export function useMessageActions(input: MessageActionsInput | null) {
  const { t } = useText();
  const reactions = input?.reactions;
  const [pending, setPending] = useState<{
    emoji: string | null;
    over: readonly ConversationReaction[] | undefined;
  } | null>(null);
  const shown =
    pending && pending.over === reactions
      ? [
          ...(pending.emoji ? [{ emoji: pending.emoji, actor: { kind: "user" as const } }] : []),
          ...(reactions ?? []).filter((reaction) => reaction.actor.kind !== "user"),
        ]
      : (reactions ?? []);
  const own = shown.find((reaction) => reaction.actor.kind === "user")?.emoji ?? null;
  const onReact = input?.onReact;
  const react = onReact
    ? (emoji: string | null) => {
        setPending({ emoji, over: reactions });
        onReact(emoji).catch((error: unknown) => {
          setPending(null);
          void haptics.notification("error");
          showFailureAlert(error, "turn", t("mobile.chat.message.reactionFailed"), t("mobile.chat.copyFailedMessage"));
        });
      }
    : undefined;
  const onDelete = input?.onDelete;
  const confirmDelete = onDelete
    ? () => {
        const text = currentText();
        Alert.alert(text.t("mobile.chat.message.deleteTitle"), text.t("mobile.chat.message.deleteBody"), [
          { text: text.t("common.cancel"), style: "cancel" },
          {
            text: text.t("common.delete"),
            style: "destructive",
            onPress: () => reportTeamResult(onDelete(), "mobile.chat.message.deleteFailed"),
          },
        ]);
      }
    : undefined;
  const onTogglePin = input?.onTogglePin;
  const togglePin = onTogglePin ? () => reportTeamResult(onTogglePin(), "mobile.chat.pins.failed") : undefined;
  const open = input
    ? () =>
        openMessageActions({
          messageId: input.messageId,
          copyText: input.copyText(),
          createdAt: input.createdAt,
          ownReaction: own,
          readAloudId: input.readAloudId,
          onReact: react,
          onReply: input.onReply,
          onBranch: input.onBranch,
          onSelectText: input.onSelectText,
          onMarkUnread: input.onMarkUnread,
          pinned: input.pinned ?? false,
          onTogglePin: togglePin,
          sendToChannel: input.sendToChannel,
          onDelete: confirmDelete,
          files: input.files,
        })
    : undefined;
  return { shown, react, open };
}

export function ChatMessageReactions({
  align,
  reactions,
  agentsById,
  onReact,
}: {
  align: "start" | "end";
  reactions: readonly ConversationReaction[];
  agentsById: ReadonlyMap<string, MobileAgent>;
  onReact?: (emoji: string | null) => void;
}) {
  const { t } = useText();
  return (
    <View
      className={`absolute -bottom-5 flex-row items-center rounded-full border-[3px] border-background bg-surface px-1 ${align === "end" ? "left-3" : "right-3"}`}
    >
      {reactions.map((reaction) =>
        reaction.actor.kind === "user" && onReact ? (
          <Pressable
            key="user"
            accessibilityRole="button"
            accessibilityLabel={t("mobile.chat.message.removeReaction", { emoji: reaction.emoji })}
            hitSlop={8}
            onPress={() => {
              void haptics.selection();
              onReact(null);
            }}
            className="h-7 items-center justify-center px-1"
            style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}
          >
            <Typography>{reaction.emoji}</Typography>
          </Pressable>
        ) : (
          <View
            key={reaction.actor.kind === "agent" ? `agent:${reaction.actor.agentId}` : "user"}
            accessible
            accessibilityRole="image"
            accessibilityLabel={
              reaction.actor.kind === "agent"
                ? t("mobile.chat.message.agentReaction", {
                    name: agentsById.get(reaction.actor.agentId)?.name ?? "",
                    emoji: reaction.emoji,
                  })
                : reaction.emoji
            }
            className="h-7 justify-center px-1"
          >
            <Typography>{reaction.emoji}</Typography>
          </View>
        ),
      )}
    </View>
  );
}

export function ChatMessageActionsButton({ align, onOpen }: { align: "start" | "end"; onOpen: () => void }) {
  const { t } = useText();
  const muted = useThemeColor("muted");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("mobile.chat.message.actions")}
      onPress={onOpen}
      className={`size-10 items-center justify-center rounded-full ${align === "end" ? "self-end" : "self-start"}`}
    >
      <Ellipsis size={18} color={String(muted)} />
    </Pressable>
  );
}
