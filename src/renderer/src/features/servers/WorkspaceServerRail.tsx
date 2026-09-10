import { Show } from "solid-js";
import { toast } from "../../components/ui";
import { errorMessage } from "../../error-message";
import { usePlatform } from "../../platform";
import { useUsage } from "../usage/usage-context";
import { ServerRail } from "./ServerRail";
import { useServerSelection } from "./server-selection";
import { useServerSettings } from "./server-settings";
import { useServers } from "./servers-context";

/**
 * The rail of team servers down the left edge, and the platform test for
 * whether there is one at all. The test lives here rather than in the shell
 * because the rail is the thing it decides about; the shell only needs to know
 * that the frame has to leave room, which it asks `serverRailVisible` itself.
 */
export function WorkspaceServerRail() {
  const platform = usePlatform();
  const { openUsage } = useUsage();
  const { servers, reorderServers, setServerMuted, setJoinServerOpen } = useServers();
  const { selectServer } = useServerSelection();
  const { openServerSettings } = useServerSettings();

  return (
    <Show when={platform.serverRailVisible()}>
      <ServerRail
        servers={servers()}
        onSelect={(serverId) =>
          void selectServer(serverId).catch((error) => {
            toast.error("Could not select the server", {
              description: errorMessage(error, "Could not switch servers. Try again."),
            });
          })
        }
        onReorder={(serverIds) => void reorderServers(serverIds)}
        onSetMuted={(serverId, muted) => void setServerMuted(serverId, muted)}
        onAdd={() => {
          if (!platform.landingPreview) setJoinServerOpen(true);
        }}
        onOpenUsage={openUsage}
        onOpenSettings={openServerSettings}
      />
    </Show>
  );
}
