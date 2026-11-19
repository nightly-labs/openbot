import { adminRoute, fields, identifier, type OptionalRouteCodec, string } from "./admin-wire";
import { routineOwner } from "./events-v1";

export const WEBHOOK_AGENT_SECRET_CAPABILITY = "webhook-agent-secret-v1";

export const WEBHOOK_AGENT_SECRET_ROUTES = {
  give: "/v1/admin/events/routines/give-secret-to-agent",
} as const;

export const WEBHOOK_AGENT_SECRET_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    WEBHOOK_AGENT_SECRET_ROUTES.give,
    adminRoute(fields({ id: identifier, owner: routineOwner }), fields({ name: string(64) })),
  ],
]);
