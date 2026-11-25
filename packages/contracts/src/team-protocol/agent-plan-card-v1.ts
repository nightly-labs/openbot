import { type AdminDecoder, adminRoute, boolean, fields, identifier, type OptionalRouteCodec } from "./admin-wire";

export const AGENT_PLAN_CARD_CAPABILITY = "agent-plan-card-v1";

export const AGENT_PLAN_CARD_ROUTES = {
  settings: "/v1/admin/agents/plan-card",
  update: "/v1/admin/agents/plan-card/update",
} as const;

const settings: AdminDecoder = fields({ quickAcknowledgement: boolean });

export const AGENT_PLAN_CARD_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_PLAN_CARD_ROUTES.settings, adminRoute(fields({ agentId: identifier }), settings)],
  [AGENT_PLAN_CARD_ROUTES.update, adminRoute(fields({ agentId: identifier, quickAcknowledgement: boolean }), settings)],
]);
