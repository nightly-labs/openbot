import { z } from "zod";

const PENDING_AGENT_DELETES_STORAGE_KEY = "openbot:pending-agent-deletes:v1";

const pendingSchema = z.record(z.string().min(1), z.record(z.string().min(1), z.number()).catch({}));

type PendingAgentDeletes = Record<string, number>;

function readAll(): Record<string, PendingAgentDeletes> {
  try {
    const parsed = pendingSchema.safeParse(
      JSON.parse(window.localStorage.getItem(PENDING_AGENT_DELETES_STORAGE_KEY) ?? "{}"),
    );
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function writeServer(serverId: string, pending: PendingAgentDeletes): void {
  try {
    const all = readAll();
    if (Object.keys(pending).length > 0) all[serverId] = pending;
    else delete all[serverId];
    window.localStorage.setItem(PENDING_AGENT_DELETES_STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

export function readPendingAgentDeletes(serverId: string): PendingAgentDeletes {
  return readAll()[serverId] ?? {};
}

export function rememberPendingAgentDelete(serverId: string, agentId: string): void {
  const pending = readPendingAgentDeletes(serverId);
  if (pending[agentId] === undefined) writeServer(serverId, { ...pending, [agentId]: Date.now() });
}

export function forgetPendingAgentDelete(serverId: string, agentId: string): void {
  const { [agentId]: forgotten, ...remaining } = readPendingAgentDeletes(serverId);
  if (forgotten !== undefined) writeServer(serverId, remaining);
}
