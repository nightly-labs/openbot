// Frozen optional agent-notification-levels-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: any signed-in member reads
// and sets, for themselves only, the notification level of this server and of each agent. "all"
// notifies each event that can notify, "needs-me" only the requests for input, an approval or a
// browser step, and "nothing" none. The level of the server replaces the level that each device of
// the member keeps for it; `null` gives each device its own level again. The level of an agent
// replaces the level of the server for that agent; `null` removes it. A server level "nothing" keeps
// every agent quiet. The host keeps the levels of each member on its own computer, applies them to
// the notifications that it sends to that member's phones, and forgets them when the member is
// removed. The read gives only the levels of agents that the member can see. A member cannot read or
// set the levels of another member. After each change, the host sends
// `agent-notification-levels-changed` with all of the member's levels to each connection of that
// member that advertises this capability, and to no other member. A mute stays on each device. The agent switch that applies to every member (`notifications` of an agent) still
// turns notifications off for all. Widening any of it needs a second capability string.
import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
} from "./admin-wire";

export const AGENT_NOTIFICATION_LEVELS_CAPABILITY = "agent-notification-levels-v1";

export const AGENT_NOTIFICATION_LEVELS_ROUTES = {
  read: "/v1/agent-notification-levels",
  set: "/v1/agent-notification-levels/set",
  server: "/v1/agent-notification-levels/server",
} as const;

/** The most agents in one snapshot, as for the hidden agents. */
export const AGENT_NOTIFICATION_LEVELS_LIMIT = 1000;

const level = oneOf("all", "needs-me", "nothing");
const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid agent notification level request.");
    return decode(input);
  };
const snapshot = fields({
  server: nullable(level),
  agents: list(fields({ agentId: identifier, level }), AGENT_NOTIFICATION_LEVELS_LIMIT),
});

export type AgentNotificationLevelsEvent = {
  type: "agent-notification-levels-changed";
  server: "all" | "needs-me" | "nothing" | null;
  agents: { agentId: string; level: "all" | "needs-me" | "nothing" }[];
};

const LEVELS = ["all", "needs-me", "nothing"] as const;
const levelOf = (value: unknown) => LEVELS.find((candidate) => candidate === value);

/** The levels event in `input`, or null for another event. A malformed levels event throws. */
export function agentNotificationLevelsEvent(input: unknown): AgentNotificationLevelsEvent | null {
  if (!isDynamicRecord(input) || input.type !== "agent-notification-levels-changed") return null;
  const server = input.server === null ? null : levelOf(input.server);
  const decoded = snapshot({ server: input.server, agents: input.agents });
  if (server === undefined || !isDynamicRecord(decoded) || !Array.isArray(decoded.agents))
    throw new Error("Invalid agent notification levels event.");
  return {
    type: "agent-notification-levels-changed",
    server,
    agents: decoded.agents.map((entry) => {
      const level = isDynamicRecord(entry) ? levelOf(entry.level) : undefined;
      if (!isDynamicRecord(entry) || typeof entry.agentId !== "string" || !level)
        throw new Error("Invalid agent notification levels event.");
      return { agentId: entry.agentId, level };
    }),
  };
}

export const AGENT_NOTIFICATION_LEVELS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_NOTIFICATION_LEVELS_ROUTES.read, adminRoute(empty, snapshot)],
  [
    AGENT_NOTIFICATION_LEVELS_ROUTES.set,
    adminRoute(exact(["agentId", "level"], fields({ agentId: identifier, level: nullable(level) })), snapshot),
  ],
  [AGENT_NOTIFICATION_LEVELS_ROUTES.server, adminRoute(exact(["level"], fields({ level: nullable(level) })), snapshot)],
]);
