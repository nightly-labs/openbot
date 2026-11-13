// Frozen optional agent-waits-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a member who can send a
// message to an agent of the host can list the open waits of that agent and cancel one of them, as
// the user of this computer can in the composer. A wait is work that the agent stopped because it
// waits for something outside the turn. The list carries at most 20 waits, each with the agent's
// note, the text of the request that the wait serves (the host cuts it to 2,000 characters), the
// routine that wakes it, and the time of its last wake. The host refuses an agent that the client
// cannot see. A cancel of a wait that is already closed is refused with the host's message. Widening
// any of it needs a second capability string.
import type { AgentWaitsSnapshot } from "../ipc-agent-waits";
import { isAgentWaitsSnapshot } from "../ipc-agent-waits";
import { adminRoute, empty, fields, identifier, list, nullable, type OptionalRouteCodec, string } from "./admin-wire";

export const AGENT_WAITS_CAPABILITY = "agent-waits-v1";

export const AGENT_WAITS_ROUTES = {
  list: "/v1/agent-waits/list",
  cancel: "/v1/agent-waits/cancel",
} as const;

/** The most characters of a request text that cross. The composer shows only the start of it. */
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

/** The list a host answers, as the client type. The transport has already run it through the codec above. */
export function decodeAgentWaitsResponse(value: unknown): AgentWaitsSnapshot {
  if (!isAgentWaitsSnapshot(value)) throw new Error("Invalid agent waits.");
  return value;
}
