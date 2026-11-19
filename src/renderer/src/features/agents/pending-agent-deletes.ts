import { z } from "zod";

const PENDING_AGENT_DELETES_STORAGE_KEY = "openbot:pending-agent-deletes:v1";

const pendingSchema = z.record(z.string().min(1), z.array(z.string().min(1)).catch([]));

function readAll(): Record<string, string[]> {
  try {
    const parsed = pendingSchema.safeParse(
      JSON.parse(window.localStorage.getItem(PENDING_AGENT_DELETES_STORAGE_KEY) ?? "{}"),
    );
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function writeServer(serverId: string, agentIds: string[]): void {
  try {
    const all = readAll();
    if (agentIds.length > 0) all[serverId] = agentIds;
    else delete all[serverId];
    window.localStorage.setItem(PENDING_AGENT_DELETES_STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

export function readPendingAgentDeletes(serverId: string): string[] {
  return readAll()[serverId] ?? [];
}

export function rememberPendingAgentDelete(serverId: string, agentId: string): void {
  const current = readPendingAgentDeletes(serverId);
  if (!current.includes(agentId)) writeServer(serverId, [...current, agentId]);
}

export function forgetPendingAgentDelete(serverId: string, agentId: string): void {
  const current = readPendingAgentDeletes(serverId);
  const remaining = current.filter((candidate) => candidate !== agentId);
  if (remaining.length !== current.length) writeServer(serverId, remaining);
}
