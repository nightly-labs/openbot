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
  supports(serverId: string): boolean;
  load(serverId: string): Promise<AgentNotificationLevelsSnapshot>;
}

export function useSyncedNotificationLevelsLoader({
  servers,
  foreground,
  supports,
  load,
}: SyncedNotificationLevelsInput): void {
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
      void loadSyncedNotificationLevels(serverId, () => loadRef.current(serverId)).catch(() =>
        read.current.delete(serverId),
      );
    }
  }, [servers, foreground, supports]);

  useEffect(() => {
    const seen = read.current;
    return () => {
      seen.clear();
      clearSyncedNotificationLevels();
    };
  }, []);
}
