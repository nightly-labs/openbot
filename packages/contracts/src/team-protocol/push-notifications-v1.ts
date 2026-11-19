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

export const PUSH_NOTIFICATIONS_CAPABILITY = "push-notifications-v1";

export const PUSH_NOTIFICATIONS_ROUTES = {
  register: "/v1/push-notifications/registration",
  remove: "/v1/push-notifications/registration/remove",
} as const;

export type PushNotificationLevel = "all" | "needs-me";

export const PUSH_NOTIFICATION_SOUNDS = ["openbot", "warm", "mech", "bubble", "press", "default", "none"] as const;
export type PushNotificationSound = (typeof PUSH_NOTIFICATION_SOUNDS)[number];

export interface PushNotificationRegistration {
  serverId: string;
  token: string | null;
  environment: "production" | "development";
  secret: string;
  locale: string;
  away: boolean;
  level: PushNotificationLevel;
  mutedUntil: number | null;
  preview: boolean;
  sound: PushNotificationSound;
  liveActivityStartedAt: number | null;
}

const pattern =
  (expression: RegExp, maximum: number): AdminDecoder =>
  (value) => {
    const text = string(maximum)(value);
    if (typeof text !== "string" || !expression.test(text)) throw new Error("Invalid push notification value.");
    return text;
  };

const pushToken = pattern(/^(?:[0-9a-f]{2}){8,256}$/u, 512);
const secret = pattern(/^[A-Za-z0-9_-]{43}$/u, 43);

export const PUSH_NOTIFICATIONS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PUSH_NOTIFICATIONS_ROUTES.register,
    adminRoute(
      fields({
        serverId: identifier,
        token: nullable(pushToken),
        environment: oneOf("production", "development"),
        secret,
        locale: string(35),
        away: boolean,
        level: oneOf("all", "needs-me"),
        mutedUntil: nullable(count),
        preview: boolean,
        sound: oneOf(...PUSH_NOTIFICATION_SOUNDS),
        liveActivityStartedAt: nullable(count),
      }),
      empty,
    ),
  ],
  [PUSH_NOTIFICATIONS_ROUTES.remove, adminRoute(empty, empty)],
]);
