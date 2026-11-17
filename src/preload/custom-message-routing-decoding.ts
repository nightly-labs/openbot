import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type CustomMessageRoutingSettings, isCustomMessageMode } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";

/** Decode FromMain independently of the renderer request decoder in main. */
export function decodeLocalCustomMessageRouting(value: unknown): CustomMessageRoutingSettings {
  if (
    !isDynamicRecord(value) ||
    typeof value.available !== "boolean" ||
    !isCustomMessageMode(value.defaultMode) ||
    !isDynamicRecord(value.agents) ||
    Object.keys(value.agents).length > INPUT_LIMITS.agents
  )
    throw new Error("Invalid custom message routing settings from main.");
  const agents: CustomMessageRoutingSettings["agents"] = {};
  for (const [id, mode] of Object.entries(value.agents)) {
    if (!id.trim() || id.length > INPUT_LIMITS.identifier || (mode !== null && !isCustomMessageMode(mode)))
      throw new Error("Invalid custom message routing agent from main.");
    Object.defineProperty(agents, id, { value: mode, enumerable: true, configurable: true, writable: true });
  }
  return { available: value.available, defaultMode: value.defaultMode, agents };
}
