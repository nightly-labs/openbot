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
