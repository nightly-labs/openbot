import { createEffect, createStore } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { useServers } from "../servers/servers-context";

const context = createSimpleContext({
  name: "UsageProvider",
  init: () => {
    const [state, setState] = createStore<{ serverId: string | null; agentId?: string }>({ serverId: null });
    const { activeServerId } = useServers();
    let trigger: HTMLElement | null = null;

    function openUsage(serverId: string, source: HTMLElement | null, agentId?: string) {
      trigger = source;
      setState((draft) => {
        draft.serverId = serverId;
        draft.agentId = agentId;
      });
    }

    /**
     * An open report follows the host the user switches to.
     *
     * This has to live here rather than in the shell that renders the panel.
     * `ServerScopeBoundary` is keyed on the active server, so everything below it
     * is disposed and rebuilt by a switch - a shell effect would initialize its
     * "previous" server to the *new* one on every mount and could never see the
     * change. This provider sits above that boundary, which is the whole reason
     * the report survives a switch, and so is the only place that can observe it.
     *
     * The trigger goes with the old scope, so `null` replaces it: Back has nothing
     * to return focus to once the element it was opened from is gone.
     */
    let previousServer = activeServerId();
    createEffect(activeServerId, (serverId) => {
      if (serverId !== previousServer && state.serverId) openUsage(serverId, null);
      previousServer = serverId;
    });

    function clear() {
      setState((draft) => {
        draft.serverId = null;
        draft.agentId = undefined;
      });
    }

    return {
      state,
      openUsage,
      closeUsage() {
        clear();
        queueMicrotask(() => {
          if (trigger?.isConnected) trigger.focus({ preventScroll: true });
        });
      },
      /**
       * Back gives focus to the element the report was opened from; this does not.
       * A command that opens a conversation - a global search result, a Dynamic
       * Island action - has to uncover it first, and the destination owns focus
       * from there: the transcript scrolls to the message the user picked, and
       * pulling focus back to the rail button would undo that.
       */
      dismissUsage: clear,
    };
  },
});
export const UsageProvider = context.provider;
export const useUsage = context.use;
