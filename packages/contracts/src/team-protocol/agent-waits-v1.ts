import type { AgentWaitsSnapshot } from "../ipc-agent-waits";
import { isAgentWaitsSnapshot } from "../ipc-agent-waits";
import { adminRoute, empty, fields, identifier, list, nullable, type OptionalRouteCodec, string } from "./admin-wire";

export const AGENT_WAITS_CAPABILITY = "agent-waits-v1";

export const AGENT_WAITS_ROUTES = {
  list: "/v1/agent-waits/list",
  cancel: "/v1/agent-waits/cancel",
} as const;

export const AGENT_WAITS_REQUEST_TEXT_LIMIT = 2_000;

const wait = fields({
  id: identifier,
  agentId: identifier,
  note: string(500),
  requestMessageId: identifier,
  requestText: string(AGENT_WAITS_REQUEST_TEXT_LIMIT),
  routineId: nullable(identifier),
  createdAt: string(160),
  wokenAt: nullable(string(160)),
  wakeDeliveryId: nullable(identifier),
});

const snapshot = fields({ agentId: identifier, waits: list(wait, 20) });

export const AGENT_WAITS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_WAITS_ROUTES.list, adminRoute(fields({ agentId: identifier }), snapshot)],
  [AGENT_WAITS_ROUTES.cancel, adminRoute(fields({ agentId: identifier, waitId: identifier }), empty)],
]);

export function decodeAgentWaitsResponse(value: unknown): AgentWaitsSnapshot {
  if (!isAgentWaitsSnapshot(value)) throw new Error("Invalid agent waits.");
  return value;
}
