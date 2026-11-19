import type { HostedServerList, HostedServerSummary } from "@openbot/contracts/hosted-servers";
import { create } from "zustand";
import type { HostedServerCalls } from "@/features/servers/api/hosted-servers";

const AVAILABILITY_TTL_MS = 60_000;

export const useHostedServerAvailability = create<{
  userId: string | null;
  available: boolean;
  serverIds: ReadonlySet<string> | null;
  ownsServers: boolean;
  checkedAt: number;
}>(() => ({ userId: null, available: false, serverIds: null, ownsServers: false, checkedAt: 0 }));

export function ownedHostedServers(list: HostedServerList) {
  return list.servers.filter((server) => server.state !== "deleted");
}

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
  } catch {}
}

const knownServers = new Map<string, HostedServerSummary>();

export function rememberHostedServer(server: HostedServerSummary): void {
  knownServers.set(server.serverId, server);
}

export function knownHostedServer(serverId: string): HostedServerSummary | null {
  return knownServers.get(serverId) ?? null;
}
