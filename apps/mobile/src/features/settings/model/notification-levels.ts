import type { AgentNotificationLevelsSnapshot, ServerNotificationLevel } from "@openbot/contracts/ipc";
import { create } from "zustand";
import { type ServerNotificationSetting, serverNotificationSetting } from "./push-notifications";

/**
 * The levels that the user chose on each server for all of their devices, as the host keeps them
 * (`agent-notification-levels-v1`). This is the one copy on the phone: Settings, the agent screen,
 * the push registration and the Live Activity read it. A server that is not in the map did not
 * answer yet, or does not serve the capability.
 */
export const useSyncedNotificationLevels = create<{
  servers: Readonly<Record<string, AgentNotificationLevelsSnapshot>>;
}>(() => ({ servers: {} }));

/** Sign-out starts a new epoch, so a read of the old session does not fill the new one. */
let epoch = 0;
/** The saves of each server. A read that started before a save does not replace its answer. */
const saves = new Map<string, number>();

/** Reads the levels of a server again. A failed read keeps the last levels. */
export async function loadSyncedNotificationLevels(
  serverId: string,
  load: () => Promise<AgentNotificationLevelsSnapshot>,
): Promise<void> {
  const started = { epoch, saves: saves.get(serverId) ?? 0 };
  const snapshot = await load();
  if (started.epoch !== epoch || started.saves !== (saves.get(serverId) ?? 0)) return;
  put(serverId, snapshot);
}

/** Keeps the answer of a save. The host answers with all levels of the server. */
export function setSyncedNotificationLevels(serverId: string, snapshot: AgentNotificationLevelsSnapshot): void {
  saves.set(serverId, (saves.get(serverId) ?? 0) + 1);
  put(serverId, snapshot);
}

/** Forgets the levels of all servers, as at sign-out. */
export function clearSyncedNotificationLevels(): void {
  epoch += 1;
  saves.clear();
  useSyncedNotificationLevels.setState({ servers: {} });
}

/**
 * The level of the whole server on this phone: the level that the user chose for all of their
 * devices, or the level of this phone when they chose none. The mute stays the mute of this phone.
 */
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
