import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { StackActions } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Pin from "lucide-react-native/icons/pin";
import PinOff from "lucide-react-native/icons/pin-off";
import { useRef } from "react";
import { Pressable, View } from "react-native";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useCSSVariable } from "uniwind";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useText } from "@/shared/lib/text";
import { END_X } from "@/shared/lib/text-direction";
import { reportTeamResult } from "../components/chat-message-actions";
import { type PinnedMessageRow, useMessagePins, usePinnedMessageRows } from "../components/use-message-pins";

const TASK_ROUTE = "task/[taskId]";
const UNPIN_WIDTH = 88;
const UNPIN_ACTION = "unpin";

const focusAt = () => String(Date.now());

function PinnedMessageItem({
  row,
  onOpen,
  onUnpin,
}: {
  row: PinnedMessageRow;
  onOpen: () => void;
  onUnpin: () => void;
}) {
  const { t } = useText();
  const swipeable = useRef<SwipeableMethods>(null);
  const [danger, dangerForeground, accent] = useThemeColor(["danger", "danger-foreground", "accent"]);
  const grouped = String(useCSSVariable("--openbot-bg-grouped"));
  const meta = [row.chat, row.pinnedBy ? t("mobile.chat.pins.pinnedBy", { name: row.pinnedBy }) : null]
    .filter((part) => part !== null)
    .join(" · ");
  const unpin = () => {
    swipeable.current?.close();
    onUnpin();
  };
  const renderUnpin = () => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("mobile.chat.pins.unpin")}
      onPress={unpin}
      className="items-center justify-center gap-1"
      style={({ pressed }) => ({ width: UNPIN_WIDTH, backgroundColor: danger, opacity: pressed ? 0.72 : 1 })}
    >
      <PinOff color={String(dangerForeground)} size={20} strokeWidth={2} />
      <Typography.Paragraph type="body-xs" weight="semibold" style={{ color: dangerForeground }}>
        {t("mobile.chat.pins.unpin")}
      </Typography.Paragraph>
    </Pressable>
  );
  return (
    <ReanimatedSwipeable
      ref={swipeable}
      friction={1}
      overshootRight={false}
      overshootLeft={false}
      rightThreshold={UNPIN_WIDTH / 2}
      leftThreshold={UNPIN_WIDTH / 2}
      containerStyle={{ backgroundColor: danger }}
      childrenContainerStyle={{ backgroundColor: grouped }}
      renderRightActions={END_X === 1 ? renderUnpin : undefined}
      renderLeftActions={END_X === -1 ? renderUnpin : undefined}
    >
      <SettingsRow
        disclosure={false}
        onPress={onOpen}
        accessibilityLabel={[t("mobile.chat.pins.jump", { name: row.author }), row.text, meta]
          .filter(Boolean)
          .join(", ")}
        accessibilityActions={[{ name: UNPIN_ACTION, label: t("mobile.chat.pins.unpin") }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === UNPIN_ACTION) onUnpin();
        }}
      >
        <View className="gap-1">
          <View className="flex-row items-baseline gap-2">
            <Typography weight="semibold" numberOfLines={1} className="shrink">
              {row.author}
            </Typography>
            <Typography type="body-xs" className="text-grouped-secondary">
              {row.time}
            </Typography>
          </View>
          <View className="flex-row gap-2.5">
            <View className="w-0.5 rounded-full" style={{ backgroundColor: accent }} />
            <Typography.Paragraph numberOfLines={2} className="flex-1 text-text-secondary">
              {row.text}
            </Typography.Paragraph>
          </View>
          {meta ? (
            <Typography type="body-xs" numberOfLines={1} className="text-grouped-secondary">
              {meta}
            </Typography>
          ) : null}
        </View>
      </SettingsRow>
    </ReanimatedSwipeable>
  );
}

export function PinnedMessagesScreen() {
  const { t } = useText();
  const sheetStack = useNavigation().getParent();
  const params = useLocalSearchParams<{ agentId: string; serverId: string; taskId?: string }>();
  const agentId = params.agentId;
  const serverId = params.serverId;
  const viewTaskId = params.taskId || null;
  const pins = useMessagePins(serverId, agentId);
  const rows = usePinnedMessageRows(serverId, agentId, pins.pins, viewTaskId);
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));

  const open = ({ pin }: PinnedMessageRow) => {
    if (pin.taskId === null) {
      router.dismissTo({
        pathname: "/chat/[agentId]",
        params: { agentId, messageId: pin.messageId, focusAt: focusAt() },
      });
    } else if (pin.taskId === viewTaskId) {
      router.dismissTo({
        pathname: "/task/[taskId]",
        params: { taskId: pin.taskId, agentId, serverId, messageId: pin.messageId, focusAt: focusAt() },
      });
    } else {
      sheetStack?.dispatch(
        StackActions.replace(TASK_ROUTE, { taskId: pin.taskId, agentId, serverId, messageId: pin.messageId }),
      );
    }
  };
  const unpin = ({ pin }: PinnedMessageRow) => {
    void reportTeamResult(pins.setPinned(pin.taskId, pin.messageId, false), "mobile.chat.pins.failed");
  };

  return (
    <SettingsContent>
      {rows.length > 0 ? (
        <SettingsSection>
          {rows.map((row) => (
            <PinnedMessageItem key={row.key} row={row} onOpen={() => open(row)} onUnpin={() => unpin(row)} />
          ))}
        </SettingsSection>
      ) : pins.loading ? (
        <Typography.Paragraph align="center" className="text-text-secondary">
          {t("common.loading")}
        </Typography.Paragraph>
      ) : pins.failed || !pins.enabled ? (
        <>
          <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text">
            {t("mobile.chat.pins.loadFailed")}
          </Typography.Paragraph>
          {pins.enabled ? (
            <SettingsSection>
              <SettingsRow disclosure={false} onPress={pins.refresh}>
                <Typography>{t("common.tryAgain")}</Typography>
              </SettingsRow>
            </SettingsSection>
          ) : null}
        </>
      ) : (
        <View className="items-center gap-1 px-8 py-12">
          <View className="mb-2 size-12 items-center justify-center rounded-full bg-grouped">
            <Pin color={muted} size={22} strokeWidth={2} />
          </View>
          <Typography.Paragraph align="center" weight="semibold">
            {t("mobile.chat.pins.emptyTitle")}
          </Typography.Paragraph>
          <Typography.Paragraph type="body-xs" align="center" className="text-text-secondary">
            {t("mobile.chat.pins.emptyBody")}
          </Typography.Paragraph>
        </View>
      )}
    </SettingsContent>
  );
}
