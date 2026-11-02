import { useEffect, useMemo, useState } from "react";
import type { MobileAgent, MobileServer } from "@/features/workspace/model/workspace-types";
import {
  type NotificationAvatar,
  notificationAvatarName,
  notificationAvatarsSupported,
  readNotificationAvatars,
  writeNotificationAvatars,
} from "./notification-avatars";

interface NotificationAvatarSyncProps {
  servers: readonly MobileServer[];
  /** False while the account directory loads, when the servers can be out of date. */
  serversReady: boolean;
  agents: readonly MobileAgent[];
}

/**
 * Keeps a picture of each agent where the Android notification service reads it, so a notification
 * shows the agent that sent it. A server that did not load keeps the pictures that the app saw last.
 */
export function NotificationAvatarSync({ servers, serversReady, agents }: NotificationAvatarSyncProps): null {
  const [saved] = useState(readNotificationAvatars);

  const index = useMemo((): NotificationAvatar[] | null => {
    if (!notificationAvatarsSupported || !serversReady) return null;
    return servers.flatMap((server) => {
      const loaded = agents.filter((agent) => agent.serverId === server.id);
      return server.state === "online" || loaded.length > 0
        ? loaded.map((agent) => ({ serverId: agent.serverId, id: agent.id, avatar: notificationAvatarName(agent) }))
        : saved.filter((agent) => agent.serverId === server.id);
    });
  }, [serversReady, servers, agents, saved]);

  useEffect(() => {
    if (index) writeNotificationAvatars(index, agents);
  }, [index, agents]);

  return null;
}
