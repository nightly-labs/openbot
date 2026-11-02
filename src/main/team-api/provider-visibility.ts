import { isAgentProvider } from "@openbot/contracts/agent-providers";
import type { AgentSummary } from "@openbot/contracts/ipc";
import type { TeamProtocolV1JsonObject, TeamProtocolV1JsonValue } from "@openbot/contracts/team-protocol/v1";

/**
 * The providers that each frozen protocol knows. Protocol 8 and later accept any provider id, so they
 * have no list. Do not change a list: it is released vocabulary. A provider added after protocol 7 is
 * hidden from every peer below protocol 8 without a change here.
 */
const FROZEN_PROVIDERS: ReadonlyMap<number, readonly string[]> = (() => {
  const v1 = ["codex", "claude", "grok"];
  const v4 = [...v1, "opencode"];
  const v5 = [...v4, "antigravity", "acp"];
  const v6 = [...v5, "cursor", "cline"];
  const v7 = [...v6, "pi", "muse"];
  return new Map([
    [1, v1],
    [2, v1],
    [3, v1],
    [4, v4],
    [5, v5],
    [6, v6],
    [7, v7],
  ]);
})();

/**
 * Tells if a peer on this protocol must not see the provider: a provider of this host that the
 * protocol's frozen list does not have. Protocol 8 and later see every provider.
 */
export function isPeerHiddenProvider(value: unknown, protocol: number): boolean {
  const known = FROZEN_PROVIDERS.get(Math.max(1, Math.min(protocol, 8)));
  return known !== undefined && isAgentProvider(value) && !known.includes(value);
}

/**
 * The same test for an object `id`. Only OpenCode and Gemini (`antigravity`) count for any object.
 * A later provider counts only for a provider status row, which has a `state`:
 * a custom endpoint saved with that id before the provider existed is a peer-visible endpoint, also in
 * the `providers` list of a custom endpoint save or delete reply, and it must stay one.
 */
function isPeerHiddenId(value: TeamProtocolV1JsonObject, protocol: number, listKey: string): boolean {
  if (value.id === "opencode" || value.id === "antigravity") return isPeerHiddenProvider(value.id, protocol);
  const statusRow = listKey === "providers" && typeof value.state === "string";
  return statusRow && isPeerHiddenProvider(value.id, protocol);
}

/** A protocol view never changes the host's stored agents or provider sessions. */
export function hiddenProviderAgentIds(agents: readonly AgentSummary[], protocol: number): Set<string> {
  return new Set(agents.filter((agent) => isPeerHiddenProvider(agent.provider, protocol)).map((agent) => agent.id));
}

export function legacyProviderView(value: unknown, hiddenIds: ReadonlySet<string>): TeamProtocolV1JsonValue {
  const json: TeamProtocolV1JsonValue = JSON.parse(JSON.stringify(value));
  return project(json, hiddenIds, 1);
}

/** Removes the named agents and the providers that the protocol does not know. See `FROZEN_PROVIDERS`. */
export function hiddenAgentView(
  value: unknown,
  hiddenIds: ReadonlySet<string>,
  protocol: 4 | 5 | 6 | 7 | 8,
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
    // A channel led by a hidden agent stays visible without a lead: the channel codec refuses a lead
    // that is not one of the members, and the hidden member is gone from the list.
    const visible =
      (field === "typingAgentId" || field === "leadAgentId") && typeof child === "string" && hiddenIds.has(child)
        ? null
        : project(child, hiddenIds, protocol, field);
    if (visible === null && child !== null && ["snapshot", "page", "approval", "request"].includes(field)) return null;
    result[field] = visible;
  }
  return result;
}
