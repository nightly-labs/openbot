import type { ServerSummary } from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import type { ServerActionCallbacks } from "@openbot/ui/features/servers/ServerActionItems";
import { useText } from "@openbot/ui/text";
import { actionToast } from "../../action-toast";
import { usePlatform } from "../../platform";
import { useSettings } from "../settings/settings-context";
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
  const {
    servers,
    setServerMuted,
    setServerNotificationLevel,
    setJoinServerOpen,
    setAddServerOpen,
    setCreateLocalServerOpen,
    hostedServersAvailable,
    hostedServerIds,
    hostedServersLoaded,
    refreshHostedServersAvailable,
  } = useServers();
  const { selectServer } = useServerSelection();
  const { openServerSettings, requestLeaveServer, requestRestartServer } = useServerSettings();
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
    if (hostedServersAvailable()) setAddServerOpen(true, "server_rail");
    else setJoinServerOpen(true);
    void refreshHostedServersAvailable();
  }

  /** Opens the dialog that names a new server on this computer. The landing preview has no main process. */
  const createLocal = platform.landingPreview ? undefined : () => setCreateLocalServerOpen(true);

  /**
   * The item for a server on this computer in the add menus of the rail and the server menu. The hosted
   * server plans show it in their "Other options" menu, so the add menus show it only when the add
   * button opens the invite dialog in place of the plans.
   */
  function addMenuCreateLocal(): (() => void) | undefined {
    return hostedServersAvailable() ? undefined : createLocal;
  }

  /** A server that runs on this computer as a child process. Delete and restart go to its supervisor. */
  function onThisComputer(serverId: string): boolean {
    return servers().some((server) => server.id === serverId && server.thisComputer === true);
  }

  const callbacks = {
    onSetMuted: (serverId, muted, durationMs) => void setServerMuted(serverId, muted, durationMs),
    onSetNotificationLevel: (serverId, level) => void setServerNotificationLevel(serverId, level),
    onOpenSettings: openServerSettings,
    onLeave: requestLeaveServer,
    // The same confirmation: main removes an owned server from the account instead of leaving it.
    onRemove: requestLeaveServer,
    canRemove: (serverId) => hostedServersLoaded() && !hostedServerIds().has(serverId) && !onThisComputer(serverId),
    // A server on this computer uses the leave confirmation, which deletes it in that case.
    onDelete: (serverId, trigger) =>
      onThisComputer(serverId) ? requestLeaveServer(serverId, trigger) : openHostedServerDelete(serverId, trigger),
    canDelete: (serverId) => hostedServerIds().has(serverId) || onThisComputer(serverId),
    onRestart: requestRestartServer,
    canRestart: (serverId) => hostedServerIds().has(serverId) || onThisComputer(serverId),
  } satisfies ServerActionCallbacks;

  return {
    orderedServers,
    select,
    add,
    createLocal,
    addMenuCreateLocal,
    addCreatesServer: hostedServersAvailable,
    callbacks,
  };
}
