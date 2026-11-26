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

export interface OutboxRowStatus {
  message: OutboxMessage;
  online: boolean;
  heldByFailed: boolean;
  showStatus: boolean;
  retry: () => void;
  edit: () => void;
  cancel: () => void;
}

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
        style={{ maxWidth, opacity: failed ? 1 : 0.55 }}
      >
        {children}
      </View>
    </MenuView>
  );
}

export function ChatOutboxStatus({ status }: { status: OutboxRowStatus }) {
  const { t } = useText();
  const muted = useThemeColor("muted");
  const [danger] = useCSSVariable(["--openbot-danger-text"]);
  if (!status.showStatus) return null;
  const { message, online, heldByFailed } = status;
  const failed = message.state === "failed";
  const text = !failed
    ? !online
      ? t("mobile.chat.outbox.sendsWhenOnline")
      : heldByFailed
        ? t("mobile.chat.outbox.waitingForFailed")
        : t("mobile.chat.outbox.waiting")
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
