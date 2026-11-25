import { z } from "zod";

export interface AgentThreadTabs {
  open: string[];
  active: string | null;
  side: string[];
}

export type ThreadTabsByServer = Record<string, Record<string, AgentThreadTabs>>;

const THREAD_TABS_STORAGE_KEY = "openbot:thread-tabs:v1";
const MAX_STORED_TABS = 50;

type ThreadTabsStorage = Pick<Storage, "getItem" | "setItem">;

const id = z.string().trim().min(1).max(200);
const idList = z.array(id.nullable().catch(null)).catch([]);
const agentTabsSchema = z.object({
  open: idList,
  active: id.nullable().catch(null),
  side: idList,
});
const threadTabsSchema = z.record(id, z.record(id, agentTabsSchema.nullable().catch(null)).catch({}));

export function readThreadTabs(storage: ThreadTabsStorage = window.localStorage): ThreadTabsByServer {
  try {
    const parsed = threadTabsSchema.safeParse(JSON.parse(storage.getItem(THREAD_TABS_STORAGE_KEY) ?? "{}"));
    if (!parsed.success) return {};
    const result: ThreadTabsByServer = {};
    for (const [serverId, agents] of Object.entries(parsed.data)) {
      const byAgent: Record<string, AgentThreadTabs> = {};
      for (const [agentId, tabs] of Object.entries(agents)) {
        if (!tabs) continue;
        const side = uniqueIds(tabs.side);
        const open = uniqueIds(tabs.open).filter((tab) => !side.includes(tab));
        if (open.length > 0 || side.length > 0 || tabs.active) byAgent[agentId] = { open, active: tabs.active, side };
      }
      if (Object.keys(byAgent).length > 0) result[serverId] = byAgent;
    }
    return result;
  } catch {
    return {};
  }
}

function uniqueIds(ids: readonly (string | null)[]): string[] {
  return [...new Set(ids.flatMap((tab) => (tab ? [tab] : [])))].slice(0, MAX_STORED_TABS);
}

export function writeThreadTabs(tabs: ThreadTabsByServer, storage: ThreadTabsStorage = window.localStorage): void {
  const stored = Object.fromEntries(
    Object.entries(tabs).map(([serverId, agents]) => [
      serverId,
      Object.fromEntries(
        Object.entries(agents).map(([agentId, agent]) => [
          agentId,
          { open: [...agent.open, ...agent.side], active: agent.active, side: agent.side },
        ]),
      ),
    ]),
  );
  try {
    storage.setItem(THREAD_TABS_STORAGE_KEY, JSON.stringify(stored));
  } catch {}
}

type SeenThreadsByServer = Record<string, Record<string, string>>;

const THREADS_SEEN_STORAGE_KEY = "openbot:thread-tabs-seen:v1";
const seenThreadsSchema = z.record(id, z.record(id, id.nullable().catch(null)).catch({}));

function readSeenThreads(storage: ThreadTabsStorage): SeenThreadsByServer {
  try {
    const parsed = seenThreadsSchema.safeParse(JSON.parse(storage.getItem(THREADS_SEEN_STORAGE_KEY) ?? "{}"));
    if (!parsed.success) return {};
    return Object.fromEntries(
      Object.entries(parsed.data).map(([serverId, agents]) => [
        serverId,
        Object.fromEntries(Object.entries(agents).flatMap(([agentId, time]) => (time ? [[agentId, time]] : []))),
      ]),
    );
  } catch {
    return {};
  }
}

export function readThreadsSeenThrough(
  serverId: string,
  agentId: string,
  storage: ThreadTabsStorage = window.localStorage,
): string | undefined {
  return readSeenThreads(storage)[serverId]?.[agentId];
}

export function writeThreadsSeenThrough(
  serverId: string,
  agentId: string,
  time: string | null,
  storage: ThreadTabsStorage = window.localStorage,
): void {
  const stored = readSeenThreads(storage);
  const agents = { ...stored[serverId] };
  if (time === null) {
    if (!(agentId in agents)) return;
    delete agents[agentId];
  } else agents[agentId] = time;
  const next = { ...stored, [serverId]: agents };
  if (Object.keys(agents).length === 0) delete next[serverId];
  try {
    storage.setItem(THREADS_SEEN_STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

export interface PendingThreadDelete {
  serverId: string;
  agentId: string;
  threadId: string;
  deadline: number;
  restore: boolean;
}

const THREAD_DELETES_STORAGE_KEY = "openbot:thread-deletes:v1";
const MAX_STORED_DELETES = 200;

const pendingDeleteSchema = z.object({
  serverId: id,
  agentId: id,
  threadId: id,
  deadline: z.number().finite(),
  restore: z.boolean(),
});
const pendingDeletesSchema = z.array(pendingDeleteSchema.nullable().catch(null)).catch([]);

export function readPendingThreadDeletes(storage: ThreadTabsStorage = window.localStorage): PendingThreadDelete[] {
  try {
    const parsed = pendingDeletesSchema.parse(JSON.parse(storage.getItem(THREAD_DELETES_STORAGE_KEY) ?? "[]"));
    return parsed.flatMap((entry) => (entry ? [entry] : [])).slice(0, MAX_STORED_DELETES);
  } catch {
    return [];
  }
}

function writePendingThreadDeletes(deletes: readonly PendingThreadDelete[], storage: ThreadTabsStorage): void {
  try {
    storage.setItem(THREAD_DELETES_STORAGE_KEY, JSON.stringify(deletes.slice(-MAX_STORED_DELETES)));
  } catch {}
}

const sameDelete = (a: PendingThreadDelete, b: Pick<PendingThreadDelete, "serverId" | "threadId">) =>
  a.serverId === b.serverId && a.threadId === b.threadId;

export function addPendingThreadDelete(
  entry: PendingThreadDelete,
  storage: ThreadTabsStorage = window.localStorage,
): void {
  writePendingThreadDeletes(
    [...readPendingThreadDeletes(storage).filter((stored) => !sameDelete(stored, entry)), entry],
    storage,
  );
}

export function takePendingThreadDelete(
  entry: Pick<PendingThreadDelete, "serverId" | "threadId">,
  storage: ThreadTabsStorage = window.localStorage,
): boolean {
  const stored = readPendingThreadDeletes(storage);
  const kept = stored.filter((candidate) => !sameDelete(candidate, entry));
  if (kept.length === stored.length) return false;
  writePendingThreadDeletes(kept, storage);
  return true;
}

export function forgetPendingThreadDeletes(
  serverId: string,
  agentId: string,
  storage: ThreadTabsStorage = window.localStorage,
): void {
  const stored = readPendingThreadDeletes(storage);
  const kept = stored.filter((entry) => entry.serverId !== serverId || entry.agentId !== agentId);
  if (kept.length !== stored.length) writePendingThreadDeletes(kept, storage);
}
