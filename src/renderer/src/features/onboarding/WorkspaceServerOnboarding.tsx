import { Show } from "solid-js";
import { useAgents } from "../agents/agents-context";
import { useServerActions } from "../servers/server-actions";
import { useServerSwitch } from "../servers/server-switch";
import { useServers } from "../servers/servers-context";
import { hostSetupProviderProps } from "./host-setup-provider-props";
import { ServerOnboarding } from "./ServerOnboarding";
import { useHostProviderSettings } from "./setup-provider-props";

/** The provider step of a joined server with no agents. Close goes back to the server open before it. */
export function WorkspaceServerOnboarding() {
  const { setServerSetupChoice } = useAgents();
  const { activeServer, servers } = useServers();
  const { previousServerId } = useServerSwitch();
  const { select } = useServerActions();
  const settings = useHostProviderSettings();
  // This computer is always on the rail, so it is the way back when the app opened on this server.
  const returnServerId = () => {
    const previous = previousServerId();
    const active = activeServer()?.id;
    return previous && previous !== active && servers().some((server) => server.id === previous) ? previous : "local";
  };
  return (
    <Show when={settings()}>
      {(host) => (
        <ServerOnboarding
          serverName={activeServer()?.name ?? ""}
          setup={hostSetupProviderProps(host())}
          onContinue={(provider, model) => setServerSetupChoice({ preferredProvider: provider, preferredModel: model })}
          onClose={() => select(returnServerId())}
        />
      )}
    </Show>
  );
}
