import { z } from "zod";

export const AGENT_SELECTION_STORAGE_KEY = "openbot:selected-agent:v1";

type AgentSelectionStorage = Pick<Storage, "getItem" | "setItem">;

const selectionSchema = z.record(z.string().min(1), z.string().min(1).nullable().catch(null));

export function readAgentSelection(storage?: AgentSelectionStorage): Record<string, string> {
  try {
    const value = (storage ?? window.localStorage).getItem(AGENT_SELECTION_STORAGE_KEY);
    const parsed = selectionSchema.safeParse(JSON.parse(value ?? "{}"));
    if (!parsed.success) return {};
    return Object.fromEntries(
      Object.entries(parsed.data).flatMap(([serverId, agentId]) => (agentId ? [[serverId, agentId]] : [])),
    );
  } catch {
    return {};
  }
}

export function writeAgentSelection(serverId: string, agentId: string, storage?: AgentSelectionStorage): void {
  try {
    const target = storage ?? window.localStorage;
    const selections = readAgentSelection(target);
    if (agentId) selections[serverId] = agentId;
    else delete selections[serverId];
    target.setItem(AGENT_SELECTION_STORAGE_KEY, JSON.stringify(selections));
  } catch {
    // A local display preference must not block agent navigation.
  }
}
