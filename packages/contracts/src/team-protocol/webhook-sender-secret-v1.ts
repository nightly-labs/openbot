// Frozen optional webhook-sender-secret-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server sets the signing secret of one webhook routine to a secret that the sender made, for
// example a Composio or Svix webhook secret. The host replaces the routine secret with it and keeps
// the route ID. The answer is empty: the secret goes to the host and never comes back. Widening any
// of it needs a second capability string.
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
