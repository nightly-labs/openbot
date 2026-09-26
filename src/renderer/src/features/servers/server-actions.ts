import type { ServerSummary } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import type { ServerActionCallbacks } from "@openbot/ui/features/servers/ServerActionItems";
import { useText } from "@openbot/ui/text";
import { usePlatform } from "../../platform";
import { useUsage } from "../usage/usage-context";
import { useServerSelection } from "./server-selection";
import { useServerSettings } from "./server-settings";
import { useServers } from "./servers-context";

/**
 * What the server rail and the server menu on the sidebar title both do with a server. The two
 * views show the same servers in the same order and must not disagree on an action.
 */
export function useServerActions() {
  const platform = usePlatform();
  const { t, errorMessage } = useText();
  const { openUsage } = useUsage();
  const { servers, setServerMuted, setServerNotificationLevel, setJoinServerOpen } = useServers();
  const { selectServer } = useServerSelection();
  const { openServerSettings } = useServerSettings();

  /** Local servers above the saved remote-server order, as the rail draws them. */
  function orderedServers(): ServerSummary[] {
    return [
      ...servers().filter((server) => server.kind === "local"),
      ...servers().filter((server) => server.kind === "remote"),
    ];
  }

  function select(serverId: string): void {
    void selectServer(serverId).catch((error) => {
      toast.error(t("server.select.failedTitle"), {
        description: errorMessage(error, t("server.select.failedDescription")),
      });
    });
  }

  function add(): void {
    if (!platform.landingPreview) setJoinServerOpen(true);
  }

  const callbacks: Required<ServerActionCallbacks> = {
    onSetMuted: (serverId, muted, durationMs) => void setServerMuted(serverId, muted, durationMs),
    onSetNotificationLevel: (serverId, level) => void setServerNotificationLevel(serverId, level),
    onOpenUsage: openUsage,
    onOpenSettings: openServerSettings,
  };

  return { orderedServers, select, add, callbacks };
}
