import { expoGoOnAndroid } from "@/shared/lib/expo-go";
import type { PushNotificationsNative } from "./push-notifications-native.types";

function load(): PushNotificationsNative | null {
  if (expoGoOnAndroid()) return null;
  const native: typeof import("./android-push-notifications.android") = require("./android-push-notifications.android");
  return native.androidPushNotifications;
}

export const pushNotificationsNative: PushNotificationsNative | null = load();
