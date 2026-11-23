import { Show } from "solid-js";
import { useAgents } from "../agents/agents-context";
import { useServerActions } from "../servers/server-actions";
import { useServerSwitch } from "../servers/server-switch";
import { useServers } from "../servers/servers-context";
import { useWindowPage } from "../window/window-page-context";
import { hostSetupProviderProps } from "./host-setup-provider-props";
import { ServerOnboarding } from "./ServerOnboarding";
import { useHostProviderSettings } from "./setup-provider-props";

export function WorkspaceServerOnboarding() {
  const { setServerSetupChoice } = useAgents();
  const { activeServer, servers } = useServers();
  const { previousServerId } = useServerSwitch();
  const { select } = useServerActions();
  const settings = useHostProviderSettings();
  const windowPage = useWindowPage();
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
          onClose={windowPage.conversationCovered() ? undefined : () => select(returnServerId())}
        />
      )}
    </Show>
  );
}
