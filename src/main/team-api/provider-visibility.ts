import { isAgentProvider } from "@openbot/contracts/agent-providers";
import type { AgentSummary } from "@openbot/contracts/ipc";
import type { TeamProtocolV1JsonObject, TeamProtocolV1JsonValue } from "@openbot/contracts/team-protocol/v1";

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

export function isPeerHiddenProvider(value: unknown, protocol: number): boolean {
  const known = FROZEN_PROVIDERS.get(Math.max(1, Math.min(protocol, 8)));
  return known !== undefined && isAgentProvider(value) && !known.includes(value);
}

function isPeerHiddenId(value: TeamProtocolV1JsonObject, protocol: number, listKey: string): boolean {
  if (value.id === "opencode" || value.id === "antigravity") return isPeerHiddenProvider(value.id, protocol);
  const statusRow = listKey === "providers" && typeof value.state === "string";
  return statusRow && isPeerHiddenProvider(value.id, protocol);
}

export function hiddenProviderAgentIds(agents: readonly AgentSummary[], protocol: number): Set<string> {
  return new Set(agents.filter((agent) => isPeerHiddenProvider(agent.provider, protocol)).map((agent) => agent.id));
}

export function legacyProviderView(value: unknown, hiddenIds: ReadonlySet<string>): TeamProtocolV1JsonValue {
  const json: TeamProtocolV1JsonValue = JSON.parse(JSON.stringify(value));
  return project(json, hiddenIds, 1);
}

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
    (value.kind !== "agent" && typeof value.agentId === "string" && hiddenIds.has(value.agentId))
  )
    return null;
  if (key === "auth" && isPeerHiddenProvider(value.kind, protocol)) return { kind: "unknown" };
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
      (field === "typingAgentId" || field === "leadAgentId") && typeof child === "string" && hiddenIds.has(child)
        ? null
        : project(child, hiddenIds, protocol, field);
    if (visible === null && child !== null && ["snapshot", "page", "approval", "request"].includes(field)) return null;
    result[field] = visible;
  }
  return result;
}
