import type { QueueDelivery } from "@openbot/contracts/ipc";
import { GlassView } from "expo-glass-effect";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import Clock from "lucide-react-native/icons/clock";
import CornerDownRight from "lucide-react-native/icons/corner-down-right";
import Pencil from "lucide-react-native/icons/pencil";
import Trash2 from "lucide-react-native/icons/trash";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { memo, type ReactNode, useState } from "react";
import { Alert, Pressable, View, type ViewStyle } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable } from "uniwind";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";
import { lineDirectionStyle, MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import type { QueuedUpload } from "../context/queued-messages-context";
import { queuedMessageLocks, queuedMessagePreview } from "../model/queued-message-view";
import { ChatGlassButton } from "./chat-glass-icon-button";
import type { ChatQueueController } from "./use-chat-queue";

/** The row of the next message, and the row under it that opens the rest of the queue. */
const NEXT_HEIGHT = 44;
const MORE_HEIGHT = 36;
const RADIUS = NEXT_HEIGHT / 2;
const GROW_MS = 280;
const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);

interface ChatQueueButtonProps {
  queue: ChatQueueController;
  /** The queued messages, a held edit and the upload that waits to join them. */
  count: number;
  /** The queued messages in their order, with the edit that this phone holds. */
  rows: readonly QueueDelivery[];
  /** The message that this phone still sends to the queue. */
  pending: QueuedUpload | null;
  liquidGlassAvailable: boolean;
  fallbackBackground: ViewStyle["backgroundColor"];
}

function openSheet(chatId: string) {
  void haptics.selection();
  router.push({ pathname: "/queued-messages", params: { chat: chatId } });
}

export const ChatQueueButton = memo(function ChatQueueButton({
  queue,
  count,
  rows,
  pending,
  liquidGlassAvailable,
  fallbackBackground,
}: ChatQueueButtonProps) {
  const { t } = useText();
  const muted = useThemeColor("muted");
  const waiting = queue.waiting.length > 0;
  const next = rows[0] ?? null;
  // A message that this phone still sends shows in the same card, so the card does not change
  // shape when the host confirms it. Its actions wait for that confirmation.
  const preview = next
    ? queuedMessagePreview(next)
    : pending
      ? pending.message.body || (pending.message.attachments ?? []).map((file) => file.name).join(", ")
      : null;
  if (preview !== null)
    return (
      <ChatQueueCard
        queue={queue}
        next={next}
        preview={preview}
        rest={count - 1}
        waiting={waiting}
        liquidGlassAvailable={liquidGlassAvailable}
        fallbackBackground={fallbackBackground}
      />
    );
  // A queue that failed to load reports no messages. Keep the entry, so the failure and its
  // retry stay reachable instead of leaving the chat with nothing to press.
  const failed = Boolean(queue.error);
  // The teammates the agent waits for are not queue rows, but the sheet shows them. Keep the
  // entry for them alone, also before the first answer arrives.
  if (!failed && !waiting) return null;
  const label = failed ? t("mobile.chat.queue.unavailable") : t("mobile.chat.queue.repliesTitle");
  return (
    <View className="mb-2 items-center">
      <ChatGlassButton
        accessibilityLabel={failed ? t("mobile.chat.queue.buttonFailed") : label}
        className="h-11 flex-row items-center gap-2 px-4"
        fallbackBackground={fallbackBackground}
        height={44}
        liquidGlassAvailable={liquidGlassAvailable}
        onPress={() => openSheet(queue.chatId)}
      >
        {failed ? (
          <TriangleAlert color={String(muted)} size={16} strokeWidth={2} />
        ) : (
          <Clock color={String(muted)} size={16} strokeWidth={2} />
        )}
        <Typography.Paragraph type="body-sm" weight="semibold">
          {label}
        </Typography.Paragraph>
        <ChevronUp color={String(muted)} size={16} strokeWidth={2} />
      </ChatGlassButton>
    </View>
  );
});

interface ChatQueueCardProps {
  queue: ChatQueueController;
  /** Null while the message is still on its way to the host queue. */
  next: QueueDelivery | null;
  preview: string;
  /** The queued messages after the next one, with the upload that waits to join them. */
  rest: number;
  waiting: boolean;
  liquidGlassAvailable: boolean;
  fallbackBackground: ViewStyle["backgroundColor"];
}

/**
 * The next queued message with its actions, as the desktop rows above the composer. A second row
 * opens the rest of the queue. The card grows to show that row with a native height transition,
 * so the composer moves with it and no frame waits for JavaScript.
 */
function ChatQueueCard({
  queue,
  next,
  preview,
  rest,
  waiting,
  liquidGlassAvailable,
  fallbackBackground,
}: ChatQueueCardProps) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const muted = String(useThemeColor("muted"));
  const foreground = String(useThemeColor("foreground"));
  const danger = String(useCSSVariable("--openbot-danger-text"));
  const held = queue.edit?.delivery ?? null;
  const locks = next ? queuedMessageLocks(next, { busy: queue.busy, online: queue.online, held }) : null;
  const locked = locks?.locked ?? true;
  const editedElsewhere = locks?.editedElsewhere ?? false;
  const more = rest > 0 || waiting;
  const moreLabel =
    rest > 0 ? t("mobile.chat.queue.more", { count: rest }) : waiting ? t("mobile.chat.queue.repliesTitle") : null;
  // The row keeps its last text while it closes, so it does not change as it leaves.
  const [shownMoreLabel, setShownMoreLabel] = useState(moreLabel);
  if (moreLabel && moreLabel !== shownMoreLabel) setShownMoreLabel(moreLabel);
  const finish = (action: Promise<boolean>) => {
    void action.then((done) => void haptics.notification(done ? "success" : "error"));
  };
  const transition = {
    transitionDuration: reducedMotion ? 0 : GROW_MS,
    transitionTimingFunction: EASE_OUT,
  };
  return (
    <View className="mb-2" style={{ paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }}>
      <Animated.View
        style={{
          borderCurve: "continuous",
          borderRadius: RADIUS,
          overflow: "hidden",
          height: NEXT_HEIGHT + (more ? MORE_HEIGHT : 0),
          transitionProperty: "height",
          ...transition,
        }}
      >
        <GlassView
          glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
          isInteractive={false}
          pointerEvents="none"
          style={{
            position: "absolute",
            inset: 0,
            borderCurve: "continuous",
            borderRadius: RADIUS,
            backgroundColor: liquidGlassAvailable ? "transparent" : fallbackBackground,
          }}
        />
        <View className="flex-row items-center pr-1" style={{ height: NEXT_HEIGHT }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("mobile.chat.queue.nextLabel", { text: preview })}
            className="min-w-0 flex-1 flex-row items-center gap-2 self-stretch pl-4"
            style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
            onPress={() => openSheet(queue.chatId)}
          >
            <Clock color={muted} size={16} strokeWidth={2} />
            <Typography.Paragraph
              type="body-sm"
              numberOfLines={1}
              className="min-w-0 flex-1"
              style={lineDirectionStyle(preview)}
            >
              {preview}
            </Typography.Paragraph>
          </Pressable>
          <CardAction
            accessibilityLabel={t("mobile.chat.queue.editNext")}
            disabled={locked || editedElsewhere || !queue.canEdit}
            onPress={() => {
              if (!next) return;
              void haptics.selection();
              router.push({ pathname: "/queued-messages/edit", params: { chat: queue.chatId, deliveryId: next.id } });
            }}
          >
            <Pencil color={foreground} size={18} strokeWidth={2} />
          </CardAction>
          {queue.activeTurnId ? (
            <CardAction
              accessibilityLabel={t("mobile.chat.queue.steerNext")}
              disabled={locked || editedElsewhere}
              onPress={() => {
                if (!next) return;
                void haptics.selection();
                finish(queue.steer(next));
              }}
            >
              <View className="flex-row items-center gap-1 px-1">
                <CornerDownRight color={foreground} size={18} strokeWidth={2} style={MIRROR_IN_RTL} />
                <Typography.Paragraph type="body-sm" weight="semibold">
                  {t("mobile.chat.queue.steer")}
                </Typography.Paragraph>
              </View>
            </CardAction>
          ) : null}
          <CardAction
            accessibilityLabel={t("mobile.chat.queue.deleteNext")}
            disabled={locked}
            onPress={() =>
              Alert.alert(t("mobile.chat.queue.deleteTitle"), t("mobile.chat.queue.deleteMessage"), [
                { text: t("mobile.chat.queue.keep"), style: "cancel" },
                { text: t("common.delete"), style: "destructive", onPress: () => next && finish(queue.remove(next)) },
              ])
            }
          >
            <Trash2 color={danger} size={18} strokeWidth={2} />
          </CardAction>
        </View>
        {/* Mounted while it closes: the card clips it as the height goes back. */}
        <Animated.View
          accessibilityElementsHidden={!more}
          importantForAccessibility={more ? "auto" : "no-hide-descendants"}
          pointerEvents={more ? "auto" : "none"}
          style={{ height: MORE_HEIGHT, opacity: more ? 1 : 0, transitionProperty: "opacity", ...transition }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              rest > 0 ? t("mobile.chat.queue.buttonLabel", { count: rest + 1 }) : (shownMoreLabel ?? undefined)
            }
            className="flex-1 flex-row items-center justify-center gap-1.5 border-separator border-t"
            style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
            onPress={() => openSheet(queue.chatId)}
          >
            <Typography.Paragraph type="body-xs" weight="semibold" className="text-muted">
              {shownMoreLabel}
            </Typography.Paragraph>
            <ChevronUp color={muted} size={14} strokeWidth={2} />
          </Pressable>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function CardAction({
  accessibilityLabel,
  children,
  disabled,
  onPress,
}: {
  accessibilityLabel: string;
  children: ReactNode;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      className="h-11 min-w-11 items-center justify-center px-1"
      style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.55 : 1 })}
      onPress={onPress}
    >
      {children}
    </Pressable>
  );
}
