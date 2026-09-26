import { ServerRail } from "@openbot/ui/features/servers/ServerRail";
import { onSettled, Show } from "solid-js";
import { useLayout } from "../../layout";
import { usePlatform } from "../../platform";
import { useServerActions } from "./server-actions";
import { useServers } from "./servers-context";

/**
 * The rail of team servers down the left edge. It is drawn once main has
 * reported the build and the user has not chosen the server menu instead,
 * which `serverRailVisible` answers; the shell asks the same question to
 * decide whether the frame has to leave room for it. The server shortcuts
 * work in both views.
 */
export function WorkspaceServerRail() {
  const platform = usePlatform();
  const layout = useLayout();
  const { reorderServers } = useServers();
  const { orderedServers, select, add, callbacks } = useServerActions();

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
      const server = orderedServers()[Number(event.key) - 1];
      if (!server) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!server.active) select(server.id);
    };
    window.addEventListener("keydown", handleServerShortcut);
    return () => window.removeEventListener("keydown", handleServerShortcut);
  });

  return (
    <Show when={layout.serverRailVisible()}>
      <ServerRail
        servers={orderedServers()}
        onSelect={select}
        onReorder={(serverIds) => void reorderServers(serverIds)}
        onAdd={add}
        {...callbacks}
      />
    </Show>
  );
}
