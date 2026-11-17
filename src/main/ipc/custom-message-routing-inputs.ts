import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { isCustomMessageMode, type SetCustomMessageRoutingInput } from "@openbot/contracts/ipc";
import { isObject, requireString } from "./validation";

/** Bounds the local renderer request before a host preference or an agent can change. */
export function parseCustomMessageRoutingInput(value: unknown): SetCustomMessageRoutingInput {
  if (!isObject(value) || Object.keys(value).some((key) => key !== "mode" && key !== "agentIds"))
    throw new Error("Invalid custom message routing input.");
  if (value.mode !== null && !isCustomMessageMode(value.mode)) throw new Error("Invalid custom message mode.");
  if (value.agentIds === undefined) {
    if (value.mode === null) throw new Error("A host message mode is required.");
    return { mode: value.mode };
  }
  if (!Array.isArray(value.agentIds) || value.agentIds.length < 1 || value.agentIds.length > INPUT_LIMITS.agents)
    throw new Error("Invalid custom message routing agents.");
  const agentIds = value.agentIds.map((id) => requireString(id, "agentId"));
  if (new Set(agentIds).size !== agentIds.length) throw new Error("Duplicate agent ids are not allowed.");
  return { mode: value.mode, agentIds };
}
