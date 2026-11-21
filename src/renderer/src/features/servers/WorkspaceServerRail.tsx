import { ServerRail } from "@openbot/ui/features/servers/ServerRail";
import { onSettled, Show } from "solid-js";
import { playActionSound } from "../../action-sounds";
import { useLayout } from "../../layout";
import { usePlatform } from "../../platform";
import { useServerActions } from "./server-actions";
import { useServers } from "./servers-context";

export function WorkspaceServerRail() {
  const platform = usePlatform();
  const layout = useLayout();
  const { reorderServers } = useServers();
  const {
    orderedServers,
    select,
    add,
    addMenuCreateLocal,
    addMenuInstallServer,
    addCreatesServer,
    hiddenLocal,
    callbacks,
  } = useServerActions();

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
      if (server.active) return;
      playActionSound("navigate");
      select(server.id);
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
        onCreateLocal={addMenuCreateLocal()}
        onInstallServer={addMenuInstallServer()}
        addCreatesServer={addCreatesServer()}
        hiddenLocal={hiddenLocal()}
        {...callbacks}
      />
    </Show>
  );
}
