import { toast } from "@openbot/ui";
import { errorMessage } from "@openbot/ui/error-message";
import { ServerRail } from "@openbot/ui/features/servers/ServerRail";
import { onSettled, Show } from "solid-js";
import { usePlatform } from "../../platform";
import { useUsage } from "../usage/usage-context";
import { useServerSelection } from "./server-selection";
import { useServerSettings } from "./server-settings";
import { useServers } from "./servers-context";

/**
 * The rail of team servers down the left edge. It is drawn once main has
 * reported the build, which `serverRailVisible` answers; the shell asks the
 * same question to decide whether the frame has to leave room for it.
 */
export function WorkspaceServerRail() {
  const platform = usePlatform();
  const { openUsage } = useUsage();
  const { servers, reorderServers, setServerMuted, setServerNotificationLevel, setJoinServerOpen } = useServers();
  const { selectServer } = useServerSelection();
  const { openServerSettings } = useServerSettings();

  function handleSelect(serverId: string): void {
    void selectServer(serverId).catch((error) => {
      toast.error("Could not select the server", {
        description: errorMessage(error, "Could not switch servers. Try again."),
      });
    });
  }

  onSettled(() => {
    const handleServerShortcut = (event: KeyboardEvent) => {
      const isMac = platform.appInfo()?.platform === "darwin";
      if (
        platform.landingPreview ||
        !platform.appInfo() ||
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.altKey ||
        event.shiftKey ||
        (isMac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) ||
        !/^[1-9]$/.test(event.key)
      ) {
        return;
      }
      // The rail keeps local servers above the saved remote-server order.
      const orderedServers = [
        ...servers().filter((server) => server.kind === "local"),
        ...servers().filter((server) => server.kind === "remote"),
      ];
      const server = orderedServers[Number(event.key) - 1];
      if (!server) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!server.active) handleSelect(server.id);
    };
    window.addEventListener("keydown", handleServerShortcut);
    return () => window.removeEventListener("keydown", handleServerShortcut);
  });

  return (
    <Show when={platform.serverRailVisible()}>
      <ServerRail
        servers={servers()}
        onSelect={handleSelect}
        onReorder={(serverIds) => void reorderServers(serverIds)}
        onSetMuted={(serverId, muted, durationMs) => void setServerMuted(serverId, muted, durationMs)}
        onSetNotificationLevel={(serverId, level) => void setServerNotificationLevel(serverId, level)}
        onAdd={() => {
          if (!platform.landingPreview) setJoinServerOpen(true);
        }}
        onOpenUsage={openUsage}
        onOpenSettings={openServerSettings}
      />
    </Show>
  );
}
