import type { AgentSummary } from "@openbot/contracts/ipc";
import { BrowserProfilesPanel } from "@openbot/ui/features/browser/BrowserProfilesPanel";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal } from "solid-js";
import { actionToast } from "../../action-toast";
import type { BrowserProfilesStore } from "./stores/browser-profiles-store";

export interface ServerBrowserProfilesOptions {
  /** The profiles of the server whose settings are open. A new store means another server. */
  store: Omit<BrowserProfilesStore, "assign">;
  /** The agents of the same server, for the names in the delete question. */
  listAgents: () => Promise<readonly Pick<AgentSummary, "id" | "name">[]>;
}

/**
 * The Browser profiles section of the server settings. It lists the profiles each time it opens,
 * and again when the settings change to another server. The list also counts the agents of the
 * shared profile, and each change lists it again, because a delete moves agents. A change made on
 * another device, such as the phone, shows while the section is open.
 */
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
      // A name only makes the delete question clearer, so a failed read leaves it out.
      props.listAgents().then(
        (agents) => {
          if (current === request) setAgentNames(new Map(agents.map((agent) => [agent.id, agent.name])));
        },
        () => undefined,
      );
      return store.follow();
    },
  );
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
    />
  );
}
