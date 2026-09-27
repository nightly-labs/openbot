import { onSettled } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { customAgentsPort } from "./custom-agents-port";
import { createCustomAgentsStore } from "./stores/custom-agents-store";

/**
 * The user's own ACP agents. Mounted beside `CustomProvidersProvider`, for the same reason: an agent
 * is a command on *this* computer, so a server switch must not discard and reload the list.
 */
const CustomAgents = createSimpleContext({
  name: "Custom agents",
  init: () => {
    const store = createCustomAgentsStore(() => customAgentsPort().customAgents);
    onSettled(() => {
      // As for the endpoints: a failure leaves the list empty, and Settings lists again on open.
      void store.refreshCustomAgents().catch(() => undefined);
    });
    return store;
  },
});

export const CustomAgentsProvider = CustomAgents.provider;
export const useCustomAgents = CustomAgents.use;
