import type { AgentSummary } from "@openbot/contracts/ipc";
import type { TeamProtocolV1JsonObject, TeamProtocolV1JsonValue } from "@openbot/contracts/team-protocol/v1";

/** A protocol view never changes the host's stored agents or provider sessions. */
export function hiddenProviderAgentIds(agents: readonly AgentSummary[]): Set<string> {
  return new Set(agents.filter((agent) => agent.provider === "opencode").map((agent) => agent.id));
}

export function legacyProviderView(value: unknown, hiddenIds: ReadonlySet<string>): TeamProtocolV1JsonValue {
  const json: TeamProtocolV1JsonValue = JSON.parse(JSON.stringify(value));
  return project(json, hiddenIds);
}

function project(value: TeamProtocolV1JsonValue, hiddenIds: ReadonlySet<string>, key = ""): TeamProtocolV1JsonValue {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if ((key === "agentOrder" || key === "agentIds") && typeof item === "string" && hiddenIds.has(item)) return [];
      const visible = project(item, hiddenIds);
      return visible === null && item !== null ? [] : [visible];
    });
  }
  if (value === null || typeof value !== "object") return value;
  if (
    value.provider === "opencode" ||
    value.id === "opencode" ||
    (typeof value.id === "string" && hiddenIds.has(value.id)) ||
    // Sender and reaction identities contain no provider-specific fields and remain valid for old peers.
    (value.kind !== "agent" && typeof value.agentId === "string" && hiddenIds.has(value.agentId))
  )
    return null;
  if (key === "auth" && value.kind === "opencode") return { kind: "unknown" };
  const result: TeamProtocolV1JsonObject = {};
  for (const [field, child] of Object.entries(value)) {
    if ((key === "agentAssignments" || key === "agents") && hiddenIds.has(field)) continue;
    const visible =
      field === "typingAgentId" && typeof child === "string" && hiddenIds.has(child)
        ? null
        : project(child, hiddenIds, field);
    if (visible === null && child !== null && ["snapshot", "page", "approval", "request"].includes(field)) return null;
    result[field] = visible;
  }
  return result;
}
