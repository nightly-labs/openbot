import { MESSAGE_REACTIONS, MORE_MESSAGE_REACTIONS, nextSpeechSpeed } from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Copy from "lucide-react-native/icons/copy";
import SmilePlus from "lucide-react-native/icons/face-slightly-smiling-plus";
import GitFork from "lucide-react-native/icons/git-fork";
import Hash from "lucide-react-native/icons/hash";
import MailDot from "lucide-react-native/icons/mail-dot";
import Reply from "lucide-react-native/icons/reply";
import Square from "lucide-react-native/icons/square";
import TextCursor from "lucide-react-native/icons/text-cursor";
import Trash2 from "lucide-react-native/icons/trash";
import Volume2 from "lucide-react-native/icons/volume-2";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { canReadAloud, toggleReadAloud, useReadingAloud } from "@/features/voice/model/message-reading";
import { canChangeReplySpeed } from "@/features/voice/model/reply-voice";
import { saveVoiceSettings, useVoiceSettings } from "@/features/voice/model/voice-settings";
import { CoveringMenuView } from "@/shared/components/covering-menu-view";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { useCopyMessage } from "../components/use-copy-message";
import { releaseMessageActions, useMessageActionsRequest } from "../model/message-actions-sheet";

const ICON_SIZE = 22;
const PRESSED = { transform: [{ scale: 0.92 }] };
/** The cell of the button that shows the other emoji. */
const MORE = "more";
/** The accessibility action of the Read aloud row that changes the speed. */
const SPEED_ACTION = "speed";

/**
 * Always two rows with the same columns: six reactions, the first five of the others and the More
 * button, or, after More, all fourteen in rows of seven.
 */
function emojiRows(all: boolean): string[][] {
  const cells = all
    ? [...MESSAGE_REACTIONS, ...MORE_MESSAGE_REACTIONS]
    : [...MESSAGE_REACTIONS, ...MORE_MESSAGE_REACTIONS.slice(0, 5), MORE];
  const columns = Math.ceil(cells.length / 2);
  return [cells.slice(0, columns), cells.slice(columns)];
}

/**
 * The sheet that a touch and hold on a message opens: the reactions on top, then Reply, Branch, Mark
 * unread and Send to channel, then the actions on the text, and Delete last. Each action closes the sheet.
 */
export function MessageActionsScreen() {
  const { t, format } = useText();
  const request = useMessageActionsRequest();
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  const danger = String(useCSSVariable("--openbot-danger-text"));
  const [moreEmoji, setMoreEmoji] = useState(false);
  const reading = useReadingAloud(request?.readAloudId ?? "");
  const speed = useVoiceSettings((state) => state.speed);
  const speedReady = useVoiceSettings((state) => state.ready);
  const { copy } = useCopyMessage(request?.copyText ?? "");
  // Runs when the sheet has closed. A selection that starts while the sheet is on screen ends when
  // the sheet takes the focus with it.
  const afterClose = useRef<(() => void) | undefined>(undefined);
  useEffect(
    () => () => {
      releaseMessageActions(request);
      afterClose.current?.();
      afterClose.current = undefined;
    },
    [request],
  );

  if (!request) return null;
  const run = (action: () => void) => {
    action();
    router.back();
  };
  const icon = String(foreground);
  const readAloudId = request.copyText ? request.readAloudId : undefined;
  /** A build without the native speed, such as Expo Go, shows the speed button disabled. */
  const canChangeSpeed = canChangeReplySpeed && speedReady;
  const speedLabel = t("mobile.chat.message.readAloudSpeed", { speed: format.number(speed) });
  const changeSpeed = () => {
    void haptics.selection();
    void saveVoiceSettings({ speed: nextSpeechSpeed(speed) }).catch(() => Alert.alert(t("mobile.settings.saveFailed")));
  };
  const sendToChannel = request.sendToChannel?.channels.length ? request.sendToChannel : undefined;
  const sent = request.createdAt
    ? format.date(new Date(request.createdAt), { dateStyle: "medium", timeStyle: "short" })
    : undefined;

  return (
    <SheetScrollView scrollEdgeEffect={false} contentContainerClassName="gap-4 px-4 pb-safe-offset-5 pt-7">
      {request.onReact ? (
        <View accessibilityRole="toolbar" accessibilityLabel={t("mobile.chat.message.addReaction")} className="gap-3">
          {emojiRows(moreEmoji).map((row) => (
            <View key={row.join("")} className="flex-row">
              {row.map((emoji) => {
                const selected = emoji === request.ownReaction;
                return (
                  <View key={emoji} className="flex-1 items-center">
                    {emoji === MORE ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("mobile.chat.message.moreEmoji")}
                        onPress={() => {
                          void haptics.selection();
                          setMoreEmoji(true);
                        }}
                        className="size-11 items-center justify-center rounded-full bg-grouped"
                        style={({ pressed }) => (pressed ? PRESSED : undefined)}
                      >
                        <SmilePlus size={20} color={String(muted)} />
                      </Pressable>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          selected
                            ? t("mobile.chat.message.removeReaction", { emoji })
                            : t("mobile.chat.message.react", { emoji })
                        }
                        accessibilityState={{ selected }}
                        onPress={() => {
                          void haptics.selection();
                          run(() => request.onReact?.(selected ? null : emoji));
                        }}
                        className={`size-11 items-center justify-center rounded-full ${selected ? "bg-accent/30" : "bg-grouped"}`}
                        style={({ pressed }) => (pressed ? PRESSED : undefined)}
                      >
                        <Typography className="text-xl">{emoji}</Typography>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      ) : null}

      {request.onReply || request.onBranch || request.onMarkUnread || sendToChannel ? (
        <SettingsSection>
          {request.onReply ? (
            <SettingsRow
              leading={<Reply size={ICON_SIZE} color={icon} style={MIRROR_IN_RTL} />}
              disclosure={false}
              onPress={() => run(() => request.onReply?.())}
            >
              <Typography>{t("mobile.chat.message.reply")}</Typography>
            </SettingsRow>
          ) : null}
          {request.onBranch ? (
            <SettingsRow
              leading={<GitFork size={ICON_SIZE} color={icon} />}
              disclosure={false}
              onPress={() => run(() => request.onBranch?.())}
            >
              <Typography>{t("mobile.chat.message.branch")}</Typography>
            </SettingsRow>
          ) : null}
          {request.onMarkUnread ? (
            <SettingsRow
              leading={<MailDot size={ICON_SIZE} color={icon} />}
              disclosure={false}
              onPress={() => run(() => request.onMarkUnread?.())}
            >
              <Typography>{t("mobile.chat.message.markUnread")}</Typography>
            </SettingsRow>
          ) : null}
          {sendToChannel ? (
            <CoveringMenuView
              accessibilityLabel={t("mobile.chat.message.sendToChannel")}
              title={t("mobile.chat.message.chooseChannel")}
              actions={sendToChannel.channels.map((channel) => ({ id: channel.id, title: channel.name }))}
              onPressAction={({ nativeEvent }) => {
                const channelId = nativeEvent.event;
                if (!sendToChannel.channels.some((channel) => channel.id === channelId)) return;
                // The channel opens when the sheet has closed.
                afterClose.current = () => sendToChannel.onSend(channelId);
                router.back();
              }}
            >
              <SettingsRow leading={<Hash size={ICON_SIZE} color={icon} />} disclosure={false}>
                <Typography>{t("mobile.chat.message.sendToChannel")}</Typography>
              </SettingsRow>
            </CoveringMenuView>
          ) : null}
        </SettingsSection>
      ) : null}

      {request.copyText || request.onSelectText ? (
        <SettingsSection footer={sent}>
          {request.copyText ? (
            <SettingsRow
              leading={<Copy size={ICON_SIZE} color={icon} />}
              disclosure={false}
              onPress={() => run(() => void copy())}
            >
              <Typography>{t("mobile.chat.message.copy")}</Typography>
            </SettingsRow>
          ) : null}
          {readAloudId ? (
            <SettingsRow
              leading={reading ? <Square size={ICON_SIZE} color={icon} /> : <Volume2 size={ICON_SIZE} color={icon} />}
              disclosure={false}
              disabled={!canReadAloud}
              onPress={() => run(() => toggleReadAloud(readAloudId, request.copyText))}
              trailing={
                speedReady ? (
                  // Changes the speed and keeps the sheet open, so the user can press again.
                  <Button
                    size="sm"
                    variant="secondary"
                    className="rounded-xl"
                    isDisabled={!canChangeSpeed}
                    accessibilityLabel={speedLabel}
                    onPress={changeSpeed}
                  >
                    <Button.Label className="text-foreground">
                      {t("mobile.chat.message.readAloudSpeedValue", { speed: format.number(speed) })}
                    </Button.Label>
                  </Button>
                ) : undefined
              }
              accessibilityActions={canChangeSpeed ? [{ name: SPEED_ACTION, label: speedLabel }] : undefined}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === SPEED_ACTION) changeSpeed();
              }}
            >
              <Typography>
                {reading ? t("mobile.chat.message.stopReading") : t("mobile.chat.message.readAloud")}
              </Typography>
            </SettingsRow>
          ) : null}
          {request.onSelectText ? (
            <SettingsRow
              leading={<TextCursor size={ICON_SIZE} color={icon} />}
              disclosure={false}
              onPress={() => {
                afterClose.current = request.onSelectText;
                router.back();
              }}
            >
              <Typography>{t("mobile.chat.message.selectText")}</Typography>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : sent ? (
        <Typography.Paragraph type="body-xs" className="px-4 text-grouped-secondary">
          {sent}
        </Typography.Paragraph>
      ) : null}

      {request.onDelete ? (
        <SettingsSection>
          <SettingsRow
            leading={<Trash2 size={ICON_SIZE} color={danger} />}
            disclosure={false}
            onPress={() => {
              // The alert that asks shows when the sheet has closed.
              afterClose.current = request.onDelete;
              router.back();
            }}
          >
            <Typography className="text-danger-text">{t("common.delete")}</Typography>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SheetScrollView>
  );
}
