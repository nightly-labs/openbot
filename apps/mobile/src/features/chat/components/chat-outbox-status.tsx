import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import CircleX from "lucide-react-native/icons/circle-x";
import Clock from "lucide-react-native/icons/clock";
import type { PropsWithChildren } from "react";
import { View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { useText } from "@/shared/lib/text";
import { type OutboxMessage, outboxRetrySafe } from "../model/outbox";

/** A message of this chat that waits on the phone or failed, and what the person can do with it. */
export interface OutboxRowStatus {
  message: OutboxMessage;
  /** Whether its server is online now. */
  online: boolean;
  /** Draw the status line under this message. Waiting messages share one, under the last of them. */
  showStatus: boolean;
  retry: () => void;
  edit: () => void;
  cancel: () => void;
}

/**
 * Touch and hold on a message that the host does not have yet opens Retry, Edit and Don't send.
 * The iOS menu sizes the message to its content with no width limit, so `maxWidth` wraps its text.
 */
export function OutboxMessageMenu({
  status,
  maxWidth,
  children,
}: PropsWithChildren<{ status: OutboxRowStatus; maxWidth: number }>) {
  const { t } = useText();
  const { theme } = useUniwind();
  const { message } = status;
  const failed = message.state === "failed";
  const retryable = failed && outboxRetrySafe(message, Date.now());
  const actions: MenuAction[] = [
    ...(retryable ? [{ id: "retry", title: t("common.retry") }] : []),
    { id: "edit", title: t("common.edit") },
    { id: "cancel", title: t("mobile.chat.outbox.cancelSend"), attributes: { destructive: true } },
  ];
  return (
    <MenuView
      colorScheme={theme === "dark" ? "dark" : "light"}
      shouldOpenOnLongPress
      style={{ alignSelf: "flex-end" }}
      // The menu says why the message did not send. The row shows only that it did not.
      title={retryable && message.error ? message.error : undefined}
      actions={actions}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "retry") status.retry();
        if (nativeEvent.event === "edit") status.edit();
        if (nativeEvent.event === "cancel") status.cancel();
      }}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityHint={t("mobile.chat.outbox.menuHint")}
        // Not sent yet: drawn lighter than the messages the host has.
        style={{ maxWidth, opacity: failed ? 1 : 0.55 }}
      >
        {children}
      </View>
    </MenuView>
  );
}

/** One short line under a message that the host does not have yet. */
export function ChatOutboxStatus({ status }: { status: OutboxRowStatus }) {
  const { t } = useText();
  const muted = useThemeColor("muted");
  const [danger] = useCSSVariable(["--openbot-danger-text"]);
  if (!status.showStatus) return null;
  const { message, online } = status;
  const failed = message.state === "failed";
  const text = !failed
    ? online
      ? t("mobile.chat.outbox.waiting")
      : t("mobile.chat.outbox.sendsWhenOnline")
    : outboxRetrySafe(message, Date.now())
      ? t("mobile.chat.outbox.failedHold")
      : t("mobile.chat.outbox.unconfirmed");
  return (
    <View
      accessible
      accessibilityRole={failed ? "alert" : "text"}
      accessibilityLabel={text}
      className="flex-row items-start gap-1 self-end px-1"
    >
      {failed ? (
        <CircleX size={12} color={String(danger)} strokeWidth={2} style={{ marginTop: 2 }} />
      ) : (
        <Clock size={12} color={String(muted)} strokeWidth={2} style={{ marginTop: 2 }} />
      )}
      <Typography.Paragraph
        type="body-xs"
        numberOfLines={2}
        className={failed ? "shrink text-danger-text" : "shrink text-muted"}
      >
        {text}
      </Typography.Paragraph>
    </View>
  );
}
