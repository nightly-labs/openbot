import type { HostedServerList, HostedServerSummary } from "@openbot/contracts/hosted-servers";
import { create } from "zustand";
import type { HostedServerCalls } from "@/features/servers/api/hosted-servers";

/** The drawer reads the answer again at most this often. */
const AVAILABILITY_TTL_MS = 60_000;

/**
 * Whether the signed-in account can have hosted servers. The plus button in the drawer then opens
 * the plans and the account's servers; otherwise it opens Join. A failed read keeps the last answer.
 * `serverIds` holds the account's hosted servers, or null before the first read. Billing deletes a
 * hosted server, so the drawer shows Remove only for a server that is not in this set.
 * `ownsServers`: the account has a hosted server that is not deleted, so the plus button opens the
 * sheet of its servers also while the feature flag is off.
 */
export const useHostedServerAvailability = create<{
  userId: string | null;
  available: boolean;
  serverIds: ReadonlySet<string> | null;
  ownsServers: boolean;
  checkedAt: number;
}>(() => ({ userId: null, available: false, serverIds: null, ownsServers: false, checkedAt: 0 }));

/** The hosted servers that the account still has: all except the deleted ones. */
export function ownedHostedServers(list: HostedServerList) {
  return list.servers.filter((server) => server.state !== "deleted");
}

/** The store values that one read of the account's hosted servers gives. */
export function hostedServerListState(list: HostedServerList) {
  return {
    available: list.available,
    serverIds: new Set(list.servers.map((server) => server.serverId)),
    ownsServers: ownedHostedServers(list).length > 0,
  };
}

export async function refreshHostedServerAvailability(userId: string, calls: HostedServerCalls): Promise<void> {
  const current = useHostedServerAvailability.getState();
  if (current.userId === userId && Date.now() - current.checkedAt < AVAILABILITY_TTL_MS) return;
  // Another account starts with no plans, and a failed read does not show the last account's answer.
  if (current.userId !== userId)
    useHostedServerAvailability.setState({
      userId,
      available: false,
      serverIds: null,
      ownsServers: false,
      checkedAt: 0,
    });
  try {
    const list = await calls.list();
    if (useHostedServerAvailability.getState().userId !== userId) return;
    useHostedServerAvailability.setState({ ...hostedServerListState(list), checkedAt: Date.now() });
  } catch {
    // The next opening of the drawer tries again.
  }
}

/** The last summary of each server, so the setup screen shows its name before the first poll. */
const knownServers = new Map<string, HostedServerSummary>();

export function rememberHostedServer(server: HostedServerSummary): void {
  knownServers.set(server.serverId, server);
}

export function knownHostedServer(serverId: string): HostedServerSummary | null {
  return knownServers.get(serverId) ?? null;
}
