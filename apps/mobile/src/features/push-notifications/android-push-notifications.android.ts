import { ANDROID_PUSH_TOKEN_PATTERN } from "@openbot/contracts/team-protocol/push-notifications-android-v1";
import { File, Paths } from "expo-file-system";
import * as Notifications from "expo-notifications";
import type { NotificationPermission } from "@/features/settings/model/push-notifications";
import { androidChannelId, createAndroidChannels } from "./android-notification-channels";
import { type PushNotificationsNative, SOUND_PREVIEW_KEY } from "./push-notifications-native.types";

const KEYS_FILE = "push-notifications.json";

export const androidPushNotifications: PushNotificationsNative = {
  async permission(asked) {
    await createAndroidChannels();
    const current = await Notifications.getPermissionsAsync();
    if (current.status !== "undetermined") return permissionOf(current);
    const answer = permissionOf(await Notifications.requestPermissionsAsync());
    asked?.(answer);
    return answer;
  },
  async deviceToken() {
    return fcmToken((await Notifications.getDevicePushTokenAsync()).data);
  },
  onDeviceToken(listener) {
    const subscription = Notifications.addPushTokenListener((device) => listener(fcmToken(device.data)));
    return () => subscription.remove();
  },
  writeKeys(servers) {
    const text = JSON.stringify({ version: 1, servers });
    const file = new File(Paths.document, KEYS_FILE);
    if (file.exists && file.textSync() === text) return;
    file.writeSync(text);
  },
  removeKeys() {
    const file = new File(Paths.document, KEYS_FILE);
    if (file.exists) file.delete();
  },
  async previewSound(sound) {
    await Notifications.scheduleNotificationAsync({
      content: { data: { [SOUND_PREVIEW_KEY]: true } },
      trigger: { channelId: androidChannelId(sound) },
    });
  },
};

function permissionOf(status: Notifications.NotificationPermissionsStatus): NotificationPermission {
  if (status.granted) return "granted";
  return status.status === "undetermined" ? "undetermined" : "denied";
}

function fcmToken(value: unknown): string | null {
  return typeof value === "string" && ANDROID_PUSH_TOKEN_PATTERN.test(value) ? value : null;
}
