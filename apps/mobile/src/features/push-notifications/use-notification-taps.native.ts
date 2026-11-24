import { expoGoOnAndroid } from "@/shared/lib/expo-go";

import type { NotificationTarget } from "./push-notifications-native.types";

type UseNotificationTaps = (
  open: (target: NotificationTarget) => void,
  onScreen: (target: NotificationTarget) => boolean,
  openWorkflows: (serverId: string) => void,
) => void;

function load(): { installNotificationHandler: () => void; useNotificationTaps: UseNotificationTaps } {
  if (expoGoOnAndroid()) return { installNotificationHandler: () => undefined, useNotificationTaps: () => undefined };
  const taps: typeof import("./notification-taps.native") = require("./notification-taps.native");
  return taps;
}

export const { installNotificationHandler, useNotificationTaps } = load();
