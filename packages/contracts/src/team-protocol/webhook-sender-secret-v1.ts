import { adminRoute, empty, fields, identifier, type OptionalRouteCodec, string } from "./admin-wire";
import { routineOwner } from "./events-v1";

export const WEBHOOK_SENDER_SECRET_CAPABILITY = "webhook-sender-secret-v1";

export const WEBHOOK_SENDER_SECRET_ROUTES = {
  set: "/v1/admin/events/routines/set-secret",
} as const;

export const WEBHOOK_SENDER_SECRET_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    WEBHOOK_SENDER_SECRET_ROUTES.set,
    adminRoute(fields({ id: identifier, owner: routineOwner, secret: string(1024) }), empty),
  ],
]);
