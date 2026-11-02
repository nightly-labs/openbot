import { expoGoOnAndroid } from "@/shared/lib/expo-go";

import type { NotificationTarget } from "./push-notifications-native.types";

type UseNotificationTaps = (open: (target: NotificationTarget) => void, openChat: () => string | null) => void;

/**
 * `expo-notifications` throws when it loads in Expo Go on Android, which has no push notifications.
 * So `notification-taps.native.ts` loads only on iOS and in a build of the app.
 */
function load(): { installNotificationHandler: () => void; useNotificationTaps: UseNotificationTaps } {
  if (expoGoOnAndroid()) return { installNotificationHandler: () => undefined, useNotificationTaps: () => undefined };
  const taps: typeof import("./notification-taps.native") = require("./notification-taps.native");
  return taps;
}

export const { installNotificationHandler, useNotificationTaps } = load();
