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
  const { openUsage, openSchedule } = useUsage();
  const {
    servers,
    setServerMuted,
    setServerNotificationLevel,
    setJoinServerOpen,
    setAddServerOpen,
    hostedServersAvailable,
    refreshHostedServersAvailable,
  } = useServers();
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

  /**
   * Opens the hosted server plans when the account can create a hosted server, otherwise the invite
   * dialog. It uses the last answer, so the click does not wait for the network; the read after it is
   * for the next click.
   */
  function add(): void {
    if (platform.landingPreview) return;
    if (hostedServersAvailable()) setAddServerOpen(true);
    else setJoinServerOpen(true);
    void refreshHostedServersAvailable();
  }

  const callbacks: Required<ServerActionCallbacks> = {
    onSetMuted: (serverId, muted, durationMs) => void setServerMuted(serverId, muted, durationMs),
    onSetNotificationLevel: (serverId, level) => void setServerNotificationLevel(serverId, level),
    onOpenUsage: openUsage,
    onOpenSchedule: openSchedule,
    onOpenSettings: openServerSettings,
  };

  return { orderedServers, select, add, addCreatesServer: hostedServersAvailable, callbacks };
}
