import { z } from "zod";

/** The chat agent last opened on each server. */
export const AGENT_SELECTION_STORAGE_KEY = "openbot:selected-agent:v1";

type AgentSelectionStorage = Pick<Storage, "getItem" | "setItem">;

const selectionSchema = z.record(z.string().min(1), z.string().min(1).nullable().catch(null));

/** Reads the agent of each server that `key` keeps. */
export function readAgentSelection(key: string, storage?: AgentSelectionStorage): Record<string, string> {
  try {
    const value = (storage ?? window.localStorage).getItem(key);
    const parsed = selectionSchema.safeParse(JSON.parse(value ?? "{}"));
    if (!parsed.success) return {};
    return Object.fromEntries(
      Object.entries(parsed.data).flatMap(([serverId, agentId]) => (agentId ? [[serverId, agentId]] : [])),
    );
  } catch {
    return {};
  }
}

export function writeAgentSelection(
  key: string,
  serverId: string,
  agentId: string,
  storage?: AgentSelectionStorage,
): void {
  try {
    const target = storage ?? window.localStorage;
    const selections = readAgentSelection(key, target);
    if (agentId) selections[serverId] = agentId;
    else delete selections[serverId];
    target.setItem(key, JSON.stringify(selections));
  } catch {
    // A local display preference must not block agent navigation.
  }
}
