import type { AgentNotificationLevelsSnapshot } from "@openbot/contracts/ipc";
import { useEffect, useRef } from "react";
import {
  clearSyncedNotificationLevels,
  loadSyncedNotificationLevels,
} from "@/features/settings/model/notification-levels";
import type { MobileServer } from "@/features/workspace/model/workspace-types";

interface SyncedNotificationLevelsInput {
  servers: readonly Pick<MobileServer, "id" | "state">[];
  foreground: boolean;
  /** Whether the server serves `agent-notification-levels-v1`. */
  supports(serverId: string): boolean;
  load(serverId: string): Promise<AgentNotificationLevelsSnapshot>;
}

/**
 * Reads the levels that the user chose for all of their devices from each online server that keeps
 * them, when it connects and when the app comes back. Another device can change them, and no host
 * event tells the phone. Sign-out forgets them.
 */
export function useSyncedNotificationLevelsLoader({
  servers,
  foreground,
  supports,
  load,
}: SyncedNotificationLevelsInput): void {
  /** The servers that the phone read since they connected or the app came back. */
  const read = useRef(new Set<string>());
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!foreground) {
      read.current.clear();
      return;
    }
    for (const server of servers) {
      if (server.state !== "online") {
        read.current.delete(server.id);
        continue;
      }
      if (read.current.has(server.id) || !supports(server.id)) continue;
      read.current.add(server.id);
      const serverId = server.id;
      // A failed read tries again at the next change of the servers.
      void loadSyncedNotificationLevels(serverId, () => loadRef.current(serverId)).catch(() =>
        read.current.delete(serverId),
      );
    }
  }, [servers, foreground, supports]);

  useEffect(() => {
    const seen = read.current;
    return () => {
      // A new mount reads each server again.
      seen.clear();
      clearSyncedNotificationLevels();
    };
  }, []);
}
