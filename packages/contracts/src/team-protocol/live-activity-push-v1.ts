// Frozen optional live-activity-push-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in member's iPhone
// gives the host the push token of its Live Activity and a secret that only the phone and the host
// know. While the phone says it is away, the host sends the island state of this member to that
// token through the OpenBot relay and Apple, sealed with keys made from the secret, so the relay and
// Apple cannot read it. The host keeps a registration in memory only, for the session that sent
// it, and forgets it when the session ends, when the phone removes it, or when Apple refuses the
// token. Widening any of it needs a second capability string.
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  list,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const LIVE_ACTIVITY_PUSH_CAPABILITY = "live-activity-push-v1";

export const LIVE_ACTIVITY_PUSH_ROUTES = {
  register: "/v1/live-activity/registration",
  remove: "/v1/live-activity/registration/remove",
} as const;

export interface LiveActivityPushRegistration {
  /** The phone's id for this host. The host puts it into the action links, which the phone reads. */
  serverId: string;
  /** The ActivityKit push token, as hex. */
  token: string;
  /** Development builds receive pushes from the APNs sandbox. */
  environment: "production" | "development";
  /** 32 random bytes as base64url. */
  secret: string;
  /** The interface language of the phone. The host uses English for a language it does not have. */
  locale: string;
  /** `true` while iOS can suspend the app. Only then does the host send updates. */
  away: boolean;
  /** The agent photos the phone saved for the widget. An agent without one shows its drawn bloub. */
  photos: Array<{ agentId: string; file: string }>;
}

const pattern =
  (expression: RegExp, maximum: number): AdminDecoder =>
  (value) => {
    const text = string(maximum)(value);
    if (typeof text !== "string" || !expression.test(text)) throw new Error("Invalid Live Activity value.");
    return text;
  };

const pushToken = pattern(/^(?:[0-9a-f]{2}){8,256}$/u, 512);
const secret = pattern(/^[A-Za-z0-9_-]{43}$/u, 43);
const photoFile = pattern(/^avatar-[A-Za-z0-9_-]+\.(?:png|jpg|webp)$/u, 512);

export const LIVE_ACTIVITY_PUSH_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    LIVE_ACTIVITY_PUSH_ROUTES.register,
    adminRoute(
      fields({
        serverId: identifier,
        token: pushToken,
        environment: oneOf("production", "development"),
        secret,
        locale: string(35),
        away: boolean,
        photos: list(fields({ agentId: identifier, file: photoFile }), 500),
      }),
      empty,
    ),
  ],
  [LIVE_ACTIVITY_PUSH_ROUTES.remove, adminRoute(empty, empty)],
]);
