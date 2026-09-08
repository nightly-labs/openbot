import { createStore } from "solid-js";
import { createSimpleContext } from "../../simple-context";

const context = createSimpleContext({
  name: "UsageProvider",
  init: () => {
    const [state, setState] = createStore<{ serverId: string | null; agentId?: string }>({ serverId: null });
    let trigger: HTMLElement | null = null;
    return {
      state,
      openUsage(serverId: string, source: HTMLElement | null, agentId?: string) {
        trigger = source;
        setState((draft) => {
          draft.serverId = serverId;
          draft.agentId = agentId;
        });
      },
      closeUsage() {
        setState((draft) => {
          draft.serverId = null;
          draft.agentId = undefined;
        });
        queueMicrotask(() => {
          if (trigger?.isConnected) trigger.focus({ preventScroll: true });
        });
      },
    };
  },
});
export const UsageProvider = context.provider;
export const useUsage = context.use;
