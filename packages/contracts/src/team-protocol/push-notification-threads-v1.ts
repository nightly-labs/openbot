// Frozen optional push-notification-threads-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in member's phone
// that advertises this capability gets a notification when a turn ends in a side thread of an agent
// that the member can see: a thread that is not the agent's own chat, the execution thread of a
// channel, or the thread of a routine. The host sends it through the registration of the phone
// (`push-notifications-v1` for an iPhone, `push-notifications-android-v1` for an Android phone), with
// the same seal, level, mute, preview and sound, and with the thread of the turn as `threadId`, which
// is the `threadId` of that side thread in `agent-tasks-v1`. A phone that does not advertise this
// capability gets none of these notifications. `set` says whether the phone of the calling session
// takes them: `replies: false` stops them for the registration of that session only, and `true` starts
// them again. A registration that never said takes them. The choice does not change the notifications
// of the agent's own chat or of a routine run, or the requests for input, an approval or a browser
// step of any thread. The host keeps the choice with the registration of the session, also after it
// restarts and when the phone registers again, and forgets it with the registration. For a session
// without a registration the host keeps nothing and answers as for a set. The route is a POST.
// Widening any of it needs a second capability string.
import { adminRoute, boolean, empty, fields, type OptionalRouteCodec } from "./admin-wire";

export const PUSH_NOTIFICATION_THREADS_CAPABILITY = "push-notification-threads-v1";

export const PUSH_NOTIFICATION_THREADS_ROUTES = {
  set: "/v1/push-notifications/threads",
} as const;

export interface PushNotificationThreadsChoice {
  /** Whether the phone takes a notification when a turn ends in a side thread. */
  replies: boolean;
}

export const PUSH_NOTIFICATION_THREADS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [PUSH_NOTIFICATION_THREADS_ROUTES.set, adminRoute(fields({ replies: boolean }), empty)],
]);
