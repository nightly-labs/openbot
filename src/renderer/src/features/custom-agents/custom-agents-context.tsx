import { onSettled } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { localCustomAgentsApi } from "./custom-agents-port";
import { createCustomAgentsStore } from "./stores/custom-agents-store";

const CustomAgents = createSimpleContext({
  name: "Custom agents",
  init: () => {
    const store = createCustomAgentsStore(localCustomAgentsApi);
    onSettled(() => {
      void store.refreshCustomAgents().catch(() => undefined);
    });
    return store;
  },
});

export const CustomAgentsProvider = CustomAgents.provider;
export const useCustomAgents = CustomAgents.use;
