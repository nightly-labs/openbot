import { NOTIFICATION_SOUND_FILES } from "@openbot/contracts/notification-relay";
import { File, Paths } from "expo-file-system";
import * as Notifications from "expo-notifications";
import type { NotificationPermission } from "@/features/settings/model/push-notifications";
import { type PushNotificationsNative, SOUND_PREVIEW_KEY } from "./push-notifications-native.types";

const APP_GROUP = "group.run.openbot.mobile";
const KEYS_FILE = "push-notifications.json";

export const pushNotificationsNative: PushNotificationsNative | null = {
  async permission(asked) {
    const current = await Notifications.getPermissionsAsync();
    if (current.ios?.status !== Notifications.IosAuthorizationStatus.NOT_DETERMINED) return permissionOf(current);
    const answer = permissionOf(
      await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } }),
    );
    asked?.(answer);
    return answer;
  },
  async deviceToken() {
    return hexToken((await Notifications.getDevicePushTokenAsync()).data);
  },
  onDeviceToken(listener) {
    const subscription = Notifications.addPushTokenListener((device) => listener(hexToken(device.data)));
    return () => subscription.remove();
  },
  writeKeys(servers) {
    const directory = Paths.appleSharedContainers[APP_GROUP];
    if (!directory) return;
    const text = JSON.stringify({ version: 1, servers });
    const file = new File(directory, KEYS_FILE);
    if (file.exists && file.textSync() === text) return;
    file.writeSync(text);
  },
  removeKeys() {
    const directory = Paths.appleSharedContainers[APP_GROUP];
    if (!directory) return;
    const file = new File(directory, KEYS_FILE);
    if (file.exists) file.delete();
  },
  async previewSound(sound) {
    await Notifications.scheduleNotificationAsync({
      content: {
        sound: sound === "default" ? "default" : NOTIFICATION_SOUND_FILES[sound],
        data: { [SOUND_PREVIEW_KEY]: true },
      },
      trigger: null,
    });
  },
};

function permissionOf(status: Notifications.NotificationPermissionsStatus): NotificationPermission {
  switch (status.ios?.status) {
    case Notifications.IosAuthorizationStatus.AUTHORIZED:
    case Notifications.IosAuthorizationStatus.PROVISIONAL:
    case Notifications.IosAuthorizationStatus.EPHEMERAL:
      return "granted";
    case Notifications.IosAuthorizationStatus.NOT_DETERMINED:
      return "undetermined";
    default:
      return "denied";
  }
}

function hexToken(value: unknown): string | null {
  return typeof value === "string" && /^(?:[0-9a-fA-F]{2}){8,256}$/u.test(value) ? value.toLowerCase() : null;
}
