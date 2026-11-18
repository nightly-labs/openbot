// Frozen optional webhook-agent-secret-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server gives a new signing secret of one webhook routine of an agent to that agent. The host makes
// the secret, saves it as an API key of the agent, and then replaces the routine secret with it. The
// route ID stays. The answer has only the key name: the secret never leaves the host. Widening any of
// it needs a second capability string.
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
