import type { ServerSummary } from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import type { ServerActionCallbacks } from "@openbot/ui/features/servers/ServerActionItems";
import type { HiddenLocalServer } from "@openbot/ui/features/servers/ServerRail";
import { useText } from "@openbot/ui/text";
import { actionToast } from "../../action-toast";
import { usePlatform } from "../../platform";
import { useSettings } from "../settings/settings-context";
import { serverSupportsCapability } from "./server-capabilities";
import { useServerSelection } from "./server-selection";
import { useServerSettings } from "./server-settings";
import { useServers } from "./servers-context";

export function useServerActions() {
  const platform = usePlatform();
  const { t, errorMessage } = useText();
  const {
    servers,
    setServerMuted,
    setJoinServerOpen,
    setAddServerOpen,
    setCreateLocalServerOpen,
    setInstallServerOpen,
    hostedServersAvailable,
    hostedServerIds,
    hostedServersLoaded,
    refreshHostedServersAvailable,
    localServerHidden,
    setLocalServerHidden,
  } = useServers();
  const { selectServer } = useServerSelection();
  const { openServerSettings, requestLeaveServer, requestRestartServer } = useServerSettings();
  const { openHostedServerDelete, openNotificationLevels } = useSettings();

  function remoteServers(): ServerSummary[] {
    return servers().filter((server) => server.kind === "remote");
  }

  function hiddenLocalServer(): ServerSummary | undefined {
    if (!localServerHidden() || remoteServers().length === 0) return undefined;
    return servers().find((server) => server.kind === "local" && !server.active);
  }

  function orderedServers(): ServerSummary[] {
    const hidden = hiddenLocalServer();
    return [...servers().filter((server) => server.kind === "local" && server !== hidden), ...remoteServers()];
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

  function add(): void {
    if (platform.landingPreview) return;
    if (hostedServersAvailable()) setAddServerOpen(true, "server_rail");
    else setJoinServerOpen(true);
    void refreshHostedServersAvailable();
  }

  const createLocal = platform.landingPreview ? undefined : () => setCreateLocalServerOpen(true);

  function addMenuCreateLocal(): (() => void) | undefined {
    return hostedServersAvailable() ? undefined : createLocal;
  }

  const installServer = platform.landingPreview ? undefined : () => setInstallServerOpen(true);

  function addMenuInstallServer(): (() => void) | undefined {
    return hostedServersAvailable() ? undefined : installServer;
  }

  async function hideLocal(serverId: string): Promise<void> {
    const other = remoteServers().find((server) => server.state === "online") ?? remoteServers()[0];
    if (!other) return;
    if (servers().some((server) => server.id === serverId && server.active)) {
      try {
        if (!(await selectServer(other.id))) return;
      } catch (error) {
        selectFailed(error);
        return;
      }
    }
    setLocalServerHidden(true);
  }

  function hiddenLocal(): HiddenLocalServer | undefined {
    const server = hiddenLocalServer();
    return server ? { name: server.name, show: () => setLocalServerHidden(false) } : undefined;
  }

  function onThisComputer(serverId: string): boolean {
    return servers().some((server) => server.id === serverId && server.thisComputer === true);
  }

  const callbacks = {
    onSetMuted: (serverId, muted, durationMs) => void setServerMuted(serverId, muted, durationMs),
    onOpenNotificationSettings: openNotificationLevels,
    onOpenSettings: openServerSettings,
    onLeave: requestLeaveServer,
    onRemove: requestLeaveServer,
    canRemove: (serverId) => hostedServersLoaded() && !hostedServerIds().has(serverId) && !onThisComputer(serverId),
    onDelete: (serverId, trigger) =>
      onThisComputer(serverId) ? requestLeaveServer(serverId, trigger) : openHostedServerDelete(serverId, trigger),
    canDelete: (serverId) => hostedServerIds().has(serverId) || onThisComputer(serverId),
    onRestart: requestRestartServer,
    canRestart: (serverId) => {
      if (hostedServerIds().has(serverId) || onThisComputer(serverId)) return true;
      const server = servers().find((candidate) => candidate.id === serverId);
      return server?.state === "online" && serverSupportsCapability(server, "host-restart-v1");
    },
    onHide: (serverId) => void hideLocal(serverId),
    canHide: () => remoteServers().length > 0,
  } satisfies ServerActionCallbacks;

  return {
    orderedServers,
    select,
    add,
    createLocal,
    addMenuCreateLocal,
    installServer,
    addMenuInstallServer,
    addCreatesServer: hostedServersAvailable,
    hiddenLocal,
    callbacks,
  };
}
