import { isString } from "@openbot/contracts/runtime-values";
import { remoteHostFingerprint } from "@openbot/team-client";

import type { MobileServer } from "./workspace-types";

// Categorical hues shared with the desktop server rail (--openbot-file-blue/-orange/-teal/-pink and
// --openbot-success). @openbot/brand ships tokens as CSS only, so JS keeps a copy.
const SERVER_ACCENTS = ["#74b9ff", "#f0a06a", "#6bc7d9", "#d98ac9", "#31cf76"] as const;

/** The accent follows the server, so a move, join, or leave does not recolor other servers. */
export function serverAccent(serverId: string): string {
  let hash = 0;
  for (const char of serverId) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return SERVER_ACCENTS[hash % SERVER_ACCENTS.length] ?? SERVER_ACCENTS[0];
}

export function serverOrderKey(apiUrl: string, userId: string): string {
  return `openbot.server-order.v1.${remoteHostFingerprint(JSON.stringify([new URL(apiUrl).origin, userId]))}`;
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

/** The local host stays first, as on desktop. Servers without a saved position keep directory order at the end. */
export function sortServers(servers: MobileServer[], order: readonly string[]): MobileServer[] {
  const position = new Map(order.map((id, index) => [id, index]));
  const local = servers.filter((server) => server.kind === "local");
  const remote = servers
    .filter((server) => server.kind !== "local")
    .map((server, index) => ({ server, rank: position.get(server.id) ?? order.length + index }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ server }) => server);
  return [...local, ...remote];
}

export function moveServerId(ids: readonly string[], serverId: string, targetIndex: number): string[] {
  const from = ids.indexOf(serverId);
  if (from < 0) return [...ids];
  const next = ids.filter((id) => id !== serverId);
  next.splice(Math.max(0, Math.min(next.length, targetIndex)), 0, serverId);
  return next;
}
