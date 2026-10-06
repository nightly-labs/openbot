import type { AgentSummary } from "@openbot/contracts/ipc";
import type { TeamProtocolV1JsonObject, TeamProtocolV1JsonValue } from "@openbot/contracts/team-protocol/v1";

/**
 * Tells if a peer on this protocol must not see the provider. No protocol knows Cursor (`cursor`) or
 * Cline (`cline`): they stay on this computer. Protocols 1 to 4 do not know Gemini (`antigravity`)
 * or custom ACP agents (`acp`), and protocols 1 to 3 do not know OpenCode.
 */
export function isPeerHiddenProvider(value: unknown, protocol: number): boolean {
  return (
    value === "cursor" ||
    value === "cline" ||
    (protocol < 5 && (value === "antigravity" || value === "acp")) ||
    (protocol < 4 && value === "opencode")
  );
}

/**
 * The same test for an object `id`. `acp`, `cursor` and `cline` count only for a provider status
 * row, which has a `state`: a custom endpoint saved with that id before the provider existed is a
 * peer-visible endpoint, also in the `providers` list of a custom endpoint save or delete reply, and
 * it must stay one.
 */
function isPeerHiddenId(value: TeamProtocolV1JsonObject, protocol: number, listKey: string): boolean {
  const statusRow = listKey === "providers" && typeof value.state === "string";
  if (value.id === "acp") return protocol < 5 && statusRow;
  if (value.id === "cursor" || value.id === "cline") return statusRow;
  return isPeerHiddenProvider(value.id, protocol);
}

/** A protocol view never changes the host's stored agents or provider sessions. */
export function hiddenProviderAgentIds(agents: readonly AgentSummary[], protocol: number): Set<string> {
  return new Set(agents.filter((agent) => isPeerHiddenProvider(agent.provider, protocol)).map((agent) => agent.id));
}

export function legacyProviderView(value: unknown, hiddenIds: ReadonlySet<string>): TeamProtocolV1JsonValue {
  const json: TeamProtocolV1JsonValue = JSON.parse(JSON.stringify(value));
  return project(json, hiddenIds, 1);
}

/**
 * Removes the named agents and the providers protocol 4 or 5 does not know. Protocol 4 knows
 * OpenCode; protocol 5 also knows Gemini and custom ACP agents. Neither knows Cursor or Cline.
 */
export function hiddenAgentView(
  value: unknown,
  hiddenIds: ReadonlySet<string>,
  protocol: 4 | 5,
): TeamProtocolV1JsonValue {
  const json: TeamProtocolV1JsonValue = JSON.parse(JSON.stringify(value));
  return project(json, hiddenIds, protocol);
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
    isPeerHiddenId(value, protocol, listKey) ||
    (typeof value.id === "string" && hiddenIds.has(value.id)) ||
    // Sender and reaction identities contain no provider-specific fields and remain valid for old peers.
    (value.kind !== "agent" && typeof value.agentId === "string" && hiddenIds.has(value.agentId))
  )
    return null;
  if (key === "auth" && isPeerHiddenProvider(value.kind, protocol)) return { kind: "unknown" };
  // An agent status names the version and the message of the provider that its `auth` names.
  const hiddenStatusProvider =
    "cliVersion" in value &&
    typeof value.auth === "object" &&
    value.auth !== null &&
    !Array.isArray(value.auth) &&
    isPeerHiddenProvider(value.auth.kind, protocol);
  const result: TeamProtocolV1JsonObject = {};
  for (const [field, child] of Object.entries(value)) {
    if ((key === "agentAssignments" || key === "agents") && hiddenIds.has(field)) continue;
    if (hiddenStatusProvider && (field === "cliVersion" || field === "message")) {
      result[field] = null;
      continue;
    }
    const visible =
      field === "typingAgentId" && typeof child === "string" && hiddenIds.has(child)
        ? null
        : project(child, hiddenIds, protocol, field);
    if (visible === null && child !== null && ["snapshot", "page", "approval", "request"].includes(field)) return null;
    result[field] = visible;
  }
  return result;
}
