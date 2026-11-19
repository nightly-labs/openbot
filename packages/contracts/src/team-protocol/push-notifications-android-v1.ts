import {
  type AdminDecoder,
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";
import {
  PUSH_NOTIFICATION_SOUNDS,
  type PushNotificationLevel,
  type PushNotificationSound,
} from "./push-notifications-v1";

export const ANDROID_PUSH_NOTIFICATIONS_CAPABILITY = "push-notifications-android-v1";

export const ANDROID_PUSH_NOTIFICATIONS_ROUTES = {
  register: "/v1/push-notifications/android-registration",
  remove: "/v1/push-notifications/android-registration/remove",
} as const;

export interface AndroidPushNotificationRegistration {
  serverId: string;
  token: string;
  secret: string;
  locale: string;
  away: boolean;
  level: PushNotificationLevel;
  mutedUntil: number | null;
  preview: boolean;
  sound: PushNotificationSound;
}

export const ANDROID_PUSH_TOKEN_PATTERN = /^[A-Za-z0-9_:-]{32,4096}$/u;

const pattern =
  (expression: RegExp, maximum: number): AdminDecoder =>
  (value) => {
    const text = string(maximum)(value);
    if (typeof text !== "string" || !expression.test(text)) throw new Error("Invalid push notification value.");
    return text;
  };

const pushToken = pattern(ANDROID_PUSH_TOKEN_PATTERN, 4096);
const secret = pattern(/^[A-Za-z0-9_-]{43}$/u, 43);

export const ANDROID_PUSH_NOTIFICATIONS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    ANDROID_PUSH_NOTIFICATIONS_ROUTES.register,
    adminRoute(
      fields({
        serverId: identifier,
        token: pushToken,
        secret,
        locale: string(35),
        away: boolean,
        level: oneOf("all", "needs-me"),
        mutedUntil: nullable(count),
        preview: boolean,
        sound: oneOf(...PUSH_NOTIFICATION_SOUNDS),
      }),
      empty,
    ),
  ],
  [ANDROID_PUSH_NOTIFICATIONS_ROUTES.remove, adminRoute(empty, empty)],
]);
