// Frozen optional agent-install-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can make the host add a new agent from a marketplace listing or from a shared agent
// template. Only ids cross the wire: the host downloads the listing or template with its own
// account, so a client never sends instructions, skills or routines. The response names the new
// agent only; the client reads it with the agent list. A member cannot use either route;
// `requireAdmin` on the host is the only gate. Widening any of it needs a second capability string.
import { adminRoute, fields, identifier, type OptionalRouteCodec, string } from "./admin-wire";

export const AGENT_INSTALL_CAPABILITY = "agent-install-v1";

export const AGENT_INSTALL_ROUTES = {
  marketplace: "/v1/admin/agents/install-marketplace",
  template: "/v1/admin/agents/install-template",
} as const;

const timezone = string(255);
const installedAgent = fields({ agentId: identifier, name: string(256) });

export const AGENT_INSTALL_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    AGENT_INSTALL_ROUTES.marketplace,
    adminRoute(fields({ listingId: identifier, timezone, receiptId: identifier }), installedAgent),
  ],
  [
    AGENT_INSTALL_ROUTES.template,
    adminRoute(fields({ templateId: identifier, timezone, expectedUpdatedAt: string(64) }), installedAgent),
  ],
]);
