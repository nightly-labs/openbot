import { isString } from "@openbot/contracts/runtime-values";
import { accountScope } from "@/shared/lib/account-scope";

const SERVER_ACCENTS = ["#74b9ff", "#f0a06a", "#6bc7d9", "#d98ac9", "#31cf76"] as const;

export function serverAccent(serverId: string): string {
  let hash = 0;
  for (const char of serverId) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return SERVER_ACCENTS[hash % SERVER_ACCENTS.length] ?? SERVER_ACCENTS[0];
}

export function serverOrderKey(apiUrl: string, userId: string): string {
  return `openbot.server-order.v1.${accountScope(apiUrl, userId)}`;
}

export function decodeServerOrder(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const value = JSON.parse(stored);
    return Array.isArray(value) ? value.filter(isString) : [];
  } catch {
    return [];
  }
}

export function defaultServerKey(apiUrl: string, userId: string): string {
  return `openbot.default-server.v1.${accountScope(apiUrl, userId)}`;
}

export function decodeDefaultServer(stored: string | null, pairedHostId: string | undefined): string | null {
  const fallback = pairedHostId ?? null;
  if (stored === null) return fallback;
  try {
    const value = JSON.parse(stored);
    return value === null || isString(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function sortServers<T extends { id: string }>(
  servers: readonly T[],
  order: readonly string[],
  defaultId: string | null,
): T[] {
  const position = new Map(order.map((id, index) => [id, index]));
  const first = servers.filter((server) => server.id === defaultId);
  const others = servers
    .filter((server) => server.id !== defaultId)
    .map((server, index) => ({ server, rank: position.get(server.id) ?? order.length + index }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ server }) => server);
  return [...first, ...others];
}

export function moveServerId(ids: readonly string[], serverId: string, targetIndex: number): string[] {
  const from = ids.indexOf(serverId);
  if (from < 0) return [...ids];
  const next = ids.filter((id) => id !== serverId);
  next.splice(Math.max(0, Math.min(next.length, targetIndex)), 0, serverId);
  return next;
}
