import { expoGoOnAndroid } from "@/shared/lib/expo-go";
import type { PushNotificationsNative } from "./push-notifications-native.types";

/**
 * Expo Go on Android has no push notifications, and `expo-notifications` throws when it loads there.
 * So `android-push-notifications.android.ts` loads only in a build of the app.
 */
function load(): PushNotificationsNative | null {
  if (expoGoOnAndroid()) return null;
  const native: typeof import("./android-push-notifications.android") = require("./android-push-notifications.android");
  return native.androidPushNotifications;
}

export const pushNotificationsNative: PushNotificationsNative | null = load();
