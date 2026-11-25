import { adminRoute, boolean, empty, fields, type OptionalRouteCodec } from "./admin-wire";

export const PUSH_NOTIFICATION_THREADS_CAPABILITY = "push-notification-threads-v1";

export const PUSH_NOTIFICATION_THREADS_ROUTES = {
  set: "/v1/push-notifications/threads",
} as const;

export interface PushNotificationThreadsChoice {
  replies: boolean;
}

export const PUSH_NOTIFICATION_THREADS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [PUSH_NOTIFICATION_THREADS_ROUTES.set, adminRoute(fields({ replies: boolean }), empty)],
]);
