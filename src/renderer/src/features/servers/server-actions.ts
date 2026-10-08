import type { ServerSummary } from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import type { ServerActionCallbacks } from "@openbot/ui/features/servers/ServerActionItems";
import { useText } from "@openbot/ui/text";
import { actionToast } from "../../action-toast";
import { usePlatform } from "../../platform";
import { useSettings } from "../settings/settings-context";
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
    activeServerId,
    servers,
    setServerMuted,
    setServerNotificationLevel,
    setJoinServerOpen,
    setAddServerOpen,
    hostedServersAvailable,
    hostedServerIds,
    refreshHostedServersAvailable,
  } = useServers();
  const { selectServer } = useServerSelection();
  const { openServerSettings, requestLeaveServer } = useServerSettings();
  const { openHostedServerDelete } = useSettings();

  /** Local servers above the saved remote-server order, as the rail draws them. */
  function orderedServers(): ServerSummary[] {
    return [
      ...servers().filter((server) => server.kind === "local"),
      ...servers().filter((server) => server.kind === "remote"),
    ];
  }

  function selectFailed(error: unknown): void {
    actionToast.error(t("server.select.failedTitle"), {
      ...{
        description: errorMessage(error, t("server.select.failedDescription")),
      },
      report: { operation: "team", source: "action", cause_code: classifyFailure(error) },
    });
  }

  function select(serverId: string): void {
    void selectServer(serverId).catch(selectFailed);
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

  const callbacks = {
    onSetMuted: (serverId, muted, durationMs) => void setServerMuted(serverId, muted, durationMs),
    onSetNotificationLevel: (serverId, level) => void setServerNotificationLevel(serverId, level),
    onOpenUsage: openUsage,
    onOpenSchedule: (serverId, trigger) => {
      if (serverId === activeServerId()) return openSchedule(serverId, trigger);
      // The schedule opens agents and channels in the active server, so it shows the active one.
      // The trigger goes with the old server.
      // A selection can also end without the server, as when a newer selection replaces it.
      void selectServer(serverId).then(
        (selected) => selected && openSchedule(serverId, null),
        (error) => selectFailed(error),
      );
    },
    onOpenSettings: openServerSettings,
    onLeave: requestLeaveServer,
    onDelete: openHostedServerDelete,
    canDelete: (serverId) => hostedServerIds().has(serverId),
  } satisfies ServerActionCallbacks;

  return { orderedServers, select, add, addCreatesServer: hostedServersAvailable, callbacks };
}
