import { NOTIFICATION_SOUND_FILES } from "@openbot/contracts/notification-relay";
import { File, Paths } from "expo-file-system";
import * as Notifications from "expo-notifications";
import type { NotificationPermission } from "@/features/settings/model/push-notifications";
import { type PushNotificationsNative, SOUND_PREVIEW_KEY } from "./push-notifications-native.types";

/** The App Group of the app and its extensions. `app.json` names the same group. */
const APP_GROUP = "group.run.openbot.mobile";
/** `NotificationService.swift` reads this file. */
const KEYS_FILE = "push-notifications.json";

/**
 * The Notification Service Extension cannot read the app keychain, so the app writes the keys of
 * each server into the App Group, as it gives the Live Activity widget its keys. The keys open
 * notifications only, and a new phone secret after sign-out makes them useless.
 */
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
    // The App Group is missing when the app was built without the extension.
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
    // A local notification goes through the same iOS sound path as a real one, with the iOS sound too.
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

/** The APNs token as lowercase hex, or `null` when iOS gave something else. */
function hexToken(value: unknown): string | null {
  return typeof value === "string" && /^(?:[0-9a-fA-F]{2}){8,256}$/u.test(value) ? value.toLowerCase() : null;
}
