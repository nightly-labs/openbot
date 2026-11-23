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
