import type { AgentNotificationLevelsSnapshot, ServerNotificationLevel } from "@openbot/contracts/ipc";
import { create } from "zustand";
import { type ServerNotificationSetting, serverNotificationSetting } from "./push-notifications";

export const useSyncedNotificationLevels = create<{
  servers: Readonly<Record<string, AgentNotificationLevelsSnapshot>>;
}>(() => ({ servers: {} }));

let epoch = 0;
const saves = new Map<string, number>();

export async function loadSyncedNotificationLevels(
  serverId: string,
  load: () => Promise<AgentNotificationLevelsSnapshot>,
): Promise<void> {
  const started = { epoch, saves: saves.get(serverId) ?? 0 };
  const snapshot = await load();
  if (started.epoch !== epoch || started.saves !== (saves.get(serverId) ?? 0)) return;
  put(serverId, snapshot);
}

export function setSyncedNotificationLevels(serverId: string, snapshot: AgentNotificationLevelsSnapshot): void {
  saves.set(serverId, (saves.get(serverId) ?? 0) + 1);
  put(serverId, snapshot);
}

export function showAgentNotificationLevel(
  serverId: string,
  agentId: string,
  level: ServerNotificationLevel | null,
): () => void {
  const previous = useSyncedNotificationLevels.getState().servers[serverId];
  if (!previous) return () => undefined;
  const others = previous.agents.filter((entry) => entry.agentId !== agentId);
  const shown: AgentNotificationLevelsSnapshot = {
    ...previous,
    agents: level === null ? others : [...others, { agentId, level }],
  };
  setSyncedNotificationLevels(serverId, shown);
  return () => {
    if (useSyncedNotificationLevels.getState().servers[serverId] === shown)
      setSyncedNotificationLevels(serverId, previous);
  };
}

export function clearSyncedNotificationLevels(): void {
  epoch += 1;
  saves.clear();
  useSyncedNotificationLevels.setState({ servers: {} });
}

export function effectiveServerNotificationSetting(
  preference: Parameters<typeof serverNotificationSetting>[0],
  synced: AgentNotificationLevelsSnapshot | undefined,
  serverId: string,
): ServerNotificationSetting {
  const setting = serverNotificationSetting(preference, serverId);
  return { ...setting, level: effectiveServerLevel(synced, setting) };
}

export function effectiveServerLevel(
  synced: AgentNotificationLevelsSnapshot | undefined,
  setting: ServerNotificationSetting,
): ServerNotificationLevel {
  return synced?.server ?? setting.level;
}

function put(serverId: string, snapshot: AgentNotificationLevelsSnapshot): void {
  useSyncedNotificationLevels.setState((state) => ({ servers: { ...state.servers, [serverId]: snapshot } }));
}
