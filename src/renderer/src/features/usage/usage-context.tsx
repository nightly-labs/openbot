import { createEffect, createStore, untrack } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { useServers } from "../servers/servers-context";

/**
 * The host pane over the middle of the workspace: the usage report, the routine schedule, the
 * tasks or the workflows. One state holds them, so each path that uncovers the conversation closes any of them.
 */
type HostPaneView = "usage" | "schedule" | "tasks" | "workflows";

const context = createSimpleContext({
  name: "UsageProvider",
  init: () => {
    const [state, setState] = createStore<{
      serverId: string | null;
      agentId?: string | undefined;
      view: HostPaneView;
    }>({
      serverId: null,
      view: "usage",
    });
    const { activeServerId } = useServers();
    let trigger: HTMLElement | null = null;

    function open(view: HostPaneView, serverId: string, source: HTMLElement | null, agentId?: string) {
      trigger = source;
      setState((draft) => {
        draft.serverId = serverId;
        if (agentId === undefined) delete draft.agentId;
        else draft.agentId = agentId;
        draft.view = view;
      });
    }

    function openUsage(serverId: string, source: HTMLElement | null, agentId?: string) {
      open("usage", serverId, source, agentId);
    }

    function openSchedule(serverId: string, source: HTMLElement | null) {
      open("schedule", serverId, source);
    }

    function openTasks(serverId: string, source: HTMLElement | null) {
      open("tasks", serverId, source);
    }

    function openWorkflows(serverId: string, source: HTMLElement | null) {
      open("workflows", serverId, source);
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
    let previousServer = untrack(activeServerId);
    createEffect(activeServerId, (serverId) => {
      if (serverId !== previousServer && untrack(() => state.serverId))
        open(
          untrack(() => state.view),
          serverId,
          null,
        );
      previousServer = serverId;
    });

    function clear() {
      setState((draft) => {
        draft.serverId = null;
        delete draft.agentId;
      });
    }

    return {
      state,
      openUsage,
      openSchedule,
      openTasks,
      openWorkflows,
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
