import type { AgentSummary } from "@openbot/contracts/ipc";
import { BrowserProfilesPanel } from "@openbot/ui/features/browser/BrowserProfilesPanel";
import type { BrowserProfileProxies } from "@openbot/ui/features/browser/BrowserProxies";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal } from "solid-js";
import { actionToast } from "../../action-toast";
import type { BrowserProfilesStore } from "./stores/browser-profiles-store";

export interface ServerBrowserProfilesOptions {
  store: Omit<BrowserProfilesStore, "assign">;
  listAgents: () => Promise<readonly Pick<AgentSummary, "id" | "name">[]>;
}

export function ServerBrowserProfilesPanel(
  props: ServerBrowserProfilesOptions & { menuMount: HTMLElement | undefined },
) {
  const { t, errorMessage } = useText();
  const [agentNames, setAgentNames] = createSignal<ReadonlyMap<string, string>>(new Map());
  let request = 0;
  createEffect(
    () => props.store,
    (store) => {
      const current = ++request;
      setAgentNames(new Map());
      store
        .refresh()
        .catch((error: unknown) => actionToast.error(errorMessage(error, t("browser.profiles.loadFailed"))));
      props.listAgents().then(
        (agents) => {
          if (current === request) setAgentNames(new Map(agents.map((agent) => [agent.id, agent.name])));
        },
        () => undefined,
      );
      return store.follow();
    },
  );
  const proxies = (): BrowserProfileProxies | undefined => {
    const list = props.store.state.proxies;
    if (!list) return undefined;
    return {
      list,
      computers: props.store.state.computers ?? [],
      sharing: props.store.state.sharing,
      onSave: props.store.saveProxy,
      onDelete: props.store.removeProxy,
      onSetProfileProxy: props.store.setProfileProxy,
      onSetSharing: props.store.setSharing,
    };
  };
  return (
    <BrowserProfilesPanel
      profiles={props.store.state.profiles}
      sharedAgentCount={props.store.state.sharedAgentIds?.length}
      agentName={(agentId) => agentNames().get(agentId)}
      onCreate={async (name) => {
        await props.store.create(name);
      }}
      onRename={props.store.rename}
      onRecolor={props.store.recolor}
      onClear={props.store.clear}
      onDelete={props.store.remove}
      menuMount={props.menuMount}
      proxies={proxies()}
    />
  );
}
