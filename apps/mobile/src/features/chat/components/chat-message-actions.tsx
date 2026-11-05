import type { ConversationReaction } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";
import { type MessageChannelTargets, openMessageActions } from "../model/message-actions-sheet";

/** A message that has actions: it is on the host and does not stream. */
export interface MessageActionsInput {
  messageId: string;
  /** The text that Copy puts on the clipboard. Empty for a message of files only. */
  copyText: string;
  createdAt?: string;
  reactions?: readonly ConversationReaction[];
  /** Unset where a reaction cannot be saved. `null` removes the reader's reaction. */
  onReact?: (emoji: string | null) => Promise<void>;
  onReply?: () => void;
  /** Unset where the message has no branch: it is not the last answer of a finished turn. */
  onBranch?: () => void;
  onSelectText?: () => void;
  /** The message that Read aloud reads. Unset where the message is not a reply. */
  readAloudId?: string;
  /** The open channels that the message text can go to. Unset where the message cannot go to one. */
  sendToChannel?: MessageChannelTargets;
  /** Deletes the message for everyone. Unset where the reader cannot delete it. */
  onDelete?: () => Promise<void>;
}

/**
 * The reactions of a message, and the sheet with its actions. The reader's reaction shows at once;
 * the host sends the saved list after it, and that list wins. `open` is unset for a message
 * without actions.
 */
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
  // The sheet has closed when this runs, so the alert shows over the chat.
  const confirmDelete = onDelete
    ? () => {
        const text = currentText();
        Alert.alert(text.t("mobile.chat.message.deleteTitle"), text.t("mobile.chat.message.deleteBody"), [
          { text: text.t("common.cancel"), style: "cancel" },
          {
            text: text.t("common.delete"),
            style: "destructive",
            onPress: () =>
              onDelete().then(
                () => void haptics.notification("success"),
                (error: unknown) => {
                  void haptics.notification("error");
                  const title = currentText().t("mobile.chat.message.deleteFailed");
                  showFailureAlert(error, "team", title, currentText().errorMessage(error, title));
                },
              ),
          },
        ]);
      }
    : undefined;
  const open = input
    ? () =>
        openMessageActions({
          messageId: input.messageId,
          copyText: input.copyText,
          createdAt: input.createdAt,
          ownReaction: own,
          readAloudId: input.readAloudId,
          onReact: react,
          onReply: input.onReply,
          onBranch: input.onBranch,
          onSelectText: input.onSelectText,
          sendToChannel: input.sendToChannel,
          onDelete: confirmDelete,
        })
    : undefined;
  return { shown, react, open };
}

/**
 * The reactions of a message, in a pill on the bottom corner of its bubble toward the middle of the
 * chat, as on desktop: bottom left for the reader's own message, bottom right for an agent's. The
 * parent keeps room under the bubble for the part of the pill that hangs below it.
 */
export function ChatMessageReactions({
  align,
  reactions,
  agentsById,
  onReact,
}: {
  /** The side of the chat the bubble sits on. */
  align: "start" | "end";
  reactions: readonly ConversationReaction[];
  agentsById: ReadonlyMap<string, MobileAgent>;
  /** Unset where a reaction cannot be saved. `null` removes the reader's reaction. */
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

/**
 * A touch and hold on the bubble opens the message actions. A screen reader cannot find that
 * gesture, so while one runs, each message gets this button under it.
 */
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
