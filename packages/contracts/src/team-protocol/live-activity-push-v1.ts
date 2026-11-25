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
  serverId: string;
  token: string;
  environment: "production" | "development";
  secret: string;
  locale: string;
  away: boolean;
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
