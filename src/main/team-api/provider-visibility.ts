import type { AgentSummary } from "@openbot/contracts/ipc";
import type { TeamProtocolV1JsonObject, TeamProtocolV1JsonValue } from "@openbot/contracts/team-protocol/v1";

/**
 * Tells if a peer on this protocol must not see the provider. Gemini (`antigravity`) and custom ACP
 * agents (`acp`) stay on this computer: no released Team protocol knows them, v4 included.
 * Protocols 1 to 3 do not know OpenCode.
 */
export function isPeerHiddenProvider(value: unknown, protocol: number): boolean {
  return value === "antigravity" || value === "acp" || (protocol < 4 && value === "opencode");
}

/**
 * The same test for an object `id`. `acp` counts only for a provider status row: a custom endpoint
 * saved as `acp` before the provider existed is a peer-visible endpoint, and it must stay one.
 */
function isPeerHiddenId(value: unknown, protocol: number, listKey: string): boolean {
  if (value === "acp") return listKey === "providers";
  return isPeerHiddenProvider(value, protocol);
}

/** A protocol view never changes the host's stored agents or provider sessions. */
export function hiddenProviderAgentIds(agents: readonly AgentSummary[], protocol: number): Set<string> {
  return new Set(agents.filter((agent) => isPeerHiddenProvider(agent.provider, protocol)).map((agent) => agent.id));
}

export function legacyProviderView(value: unknown, hiddenIds: ReadonlySet<string>): TeamProtocolV1JsonValue {
  const json: TeamProtocolV1JsonValue = JSON.parse(JSON.stringify(value));
  return project(json, hiddenIds, 1);
}

/** Removes the named agents and the local-only providers. Protocol 4 knows OpenCode, so it stays. */
export function hiddenAgentView(value: unknown, hiddenIds: ReadonlySet<string>): TeamProtocolV1JsonValue {
  const json: TeamProtocolV1JsonValue = JSON.parse(JSON.stringify(value));
  return project(json, hiddenIds, 4);
}

function project(
  value: TeamProtocolV1JsonValue,
  hiddenIds: ReadonlySet<string>,
  protocol: number,
  key = "",
  listKey = "",
): TeamProtocolV1JsonValue {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if ((key === "agentOrder" || key === "agentIds") && typeof item === "string" && hiddenIds.has(item)) return [];
      const visible = project(item, hiddenIds, protocol, "", key);
      return visible === null && item !== null ? [] : [visible];
    });
  }
  if (value === null || typeof value !== "object") return value;
  if (
    isPeerHiddenProvider(value.provider, protocol) ||
    isPeerHiddenId(value.id, protocol, listKey) ||
    (typeof value.id === "string" && hiddenIds.has(value.id)) ||
    // Sender and reaction identities contain no provider-specific fields and remain valid for old peers.
    (value.kind !== "agent" && typeof value.agentId === "string" && hiddenIds.has(value.agentId))
  )
    return null;
  if (key === "auth" && isPeerHiddenProvider(value.kind, protocol)) return { kind: "unknown" };
  const result: TeamProtocolV1JsonObject = {};
  for (const [field, child] of Object.entries(value)) {
    if ((key === "agentAssignments" || key === "agents") && hiddenIds.has(field)) continue;
    const visible =
      field === "typingAgentId" && typeof child === "string" && hiddenIds.has(child)
        ? null
        : project(child, hiddenIds, protocol, field);
    if (visible === null && child !== null && ["snapshot", "page", "approval", "request"].includes(field)) return null;
    result[field] = visible;
  }
  return result;
}
