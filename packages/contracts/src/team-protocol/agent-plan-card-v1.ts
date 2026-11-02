// Frozen optional agent-plan-card-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and change whether each agent shows its plan card before a long task on that host
// (`quickAcknowledgement`). The read gives the value that applies: the agent's own setting, else the
// host default. The card starts the work after 10 s, or when a person presses Start. A member cannot
// use either route; `requireAdmin` on the host is the only gate. A protocol 9 capability only.
// Widening any of it needs a second capability string.
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
