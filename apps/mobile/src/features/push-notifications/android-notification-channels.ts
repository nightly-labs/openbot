import { NOTIFICATION_SOUNDS, type NotificationSound } from "@openbot/contracts/notification-relay";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import * as Notifications from "expo-notifications";
import { currentText } from "@/shared/lib/text";

export function androidChannelId(sound: NotificationSound | null): string {
  if (sound === null || sound === "default") return `openbot.sound.${sound ?? "none"}`;
  return `openbot.sound.${sound}.v2`;
}

/** The channel of a chat bubble. `ChatBubbleNotification.kt` uses the same id. */
export const CHAT_BUBBLE_CHANNEL_ID = "openbot.bubble";

const SOUND_FILES: Readonly<Record<Exclude<NotificationSound, "default">, string>> = {
  openbot: "openbot_task.wav",
  warm: "openbot_warm.wav",
  mech: "openbot_mech.wav",
  bubble: "openbot_bubble.wav",
  press: "openbot_press.wav",
};

const SOUND_LABELS = {
  openbot: "mobile.settings.notifications.sound.openbot",
  warm: "mobile.settings.notifications.sound.warm",
  mech: "mobile.settings.notifications.sound.mech",
  bubble: "mobile.settings.notifications.sound.bubble",
  press: "mobile.settings.notifications.sound.press",
  default: "mobile.settings.notifications.sound.defaultAndroid",
} as const satisfies Record<NotificationSound, MobileTextKey>;

export async function createAndroidChannels(): Promise<void> {
  const { t } = currentText();
  for (const sound of Object.keys(SOUND_FILES)) {
    await Notifications.deleteNotificationChannelAsync(`openbot.sound.${sound}`);
  }
  for (const sound of NOTIFICATION_SOUNDS) {
    await Notifications.setNotificationChannelAsync(androidChannelId(sound), {
      name: t("mobile.settings.notifications.channel", { sound: t(SOUND_LABELS[sound]) }),
      importance: Notifications.AndroidImportance.HIGH,
      ...(sound === "default" ? {} : { sound: SOUND_FILES[sound] }),
    });
  }
  await Notifications.setNotificationChannelAsync(androidChannelId(null), {
    name: t("mobile.settings.notifications.channelSilent"),
    importance: Notifications.AndroidImportance.HIGH,
    sound: null,
    enableVibrate: false,
  });
  await Notifications.setNotificationChannelAsync(CHAT_BUBBLE_CHANNEL_ID, {
    name: t("mobile.settings.chatBubble.channel"),
    importance: Notifications.AndroidImportance.HIGH,
    sound: null,
    enableVibrate: false,
  });
}
