import { z } from "zod";

type ServerOrderStorage = Pick<Storage, "getItem" | "setItem">;

const serverOrderSchema = z.array(z.string().trim().min(1));

function serverOrderKey(accountId: string): string {
  return `openbot.web.server-order:${accountId}`;
}

/** The rail order that this browser keeps for one account. Mobile keeps its own order the same way. */
export function readWebServerOrder(accountId: string, storage: ServerOrderStorage = window.localStorage): string[] {
  try {
    const parsed = serverOrderSchema.safeParse(JSON.parse(storage.getItem(serverOrderKey(accountId)) ?? "[]"));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function writeWebServerOrder(
  accountId: string,
  hostIds: readonly string[],
  storage: ServerOrderStorage = window.localStorage,
): void {
  try {
    storage.setItem(serverOrderKey(accountId), JSON.stringify(hostIds));
  } catch {
    // A UI preference must not block navigation when browser storage is unavailable.
  }
}

/** Saved hosts come first. A host without a saved position keeps its directory order at the end. */
export function orderWebHosts<T extends { hostId: string }>(hosts: readonly T[], order: readonly string[]): T[] {
  const position = new Map(order.map((id, index) => [id, index]));
  return hosts
    .map((host, index) => ({ host, rank: position.get(host.hostId) ?? order.length + index }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ host }) => host);
}
