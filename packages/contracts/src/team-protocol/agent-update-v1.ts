// Frozen optional agent-update-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can make the host update one of its agents that was added from a marketplace listing, to
// the listing's current version. Only ids cross the wire: the host downloads the listing with its own
// account and refuses an agent added from another listing. The update replaces the listing's skills
// and routines on that agent, as a local update does. A member cannot use the route; `requireAdmin` on
// the host is the only gate. Widening any of it needs a second capability string.
import { adminRoute, fields, identifier, type OptionalRouteCodec, string } from "./admin-wire";

export const AGENT_UPDATE_CAPABILITY = "agent-update-v1";

export const AGENT_UPDATE_ROUTES = {
  marketplace: "/v1/admin/agents/update-marketplace",
} as const;

export const AGENT_UPDATE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    AGENT_UPDATE_ROUTES.marketplace,
    adminRoute(
      fields({ agentId: identifier, listingId: identifier, timezone: string(255) }),
      fields({ agentId: identifier, name: string(256) }),
    ),
  ],
]);
