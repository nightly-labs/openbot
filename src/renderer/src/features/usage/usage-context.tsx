import { CRM_CAPABILITY } from "@openbot/contracts/team-protocol/crm-v1";
import { createEffect, createMemo, createSignal, createStore, untrack } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { createCrmEnabled } from "../crm/crm-enabled";
import { desktopCrmHost } from "../crm/crm-port";
import { serverCanAdminister } from "../servers/server-capabilities";
import { useServers } from "../servers/servers-context";

/**
 * The host pane over the middle of the workspace: the usage report, the routine schedule, the
 * tasks, the workflows, the Library or the CRM. One state holds them, so each path that uncovers the conversation closes any of them.
 */
type HostPaneView = "usage" | "schedule" | "tasks" | "workflows" | "library" | "crm";

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
    /**
     * The workflow that the workflows page of `serverId` opens, such as the one of a clicked
     * notification. The page takes it once, so a later mount opens its first workflow again.
     */
    const [workflowRequest, setWorkflowRequest] = createSignal<{ serverId: string; workflowId: string }>();
    /** The server whose CRM page opens its connectors. The page takes it once. */
    const [crmConnectorsRequest, setCrmConnectorsRequest] = createSignal<string>();
    const { activeServer, activeServerId } = useServers();
    /** The active server when this person may read its CRM: an owner or admin, on a host with `crm-v1`. */
    const crmServerId = createMemo(() => {
      const server = activeServer();
      return serverCanAdminister(server, CRM_CAPABILITY) ? server.id : undefined;
    });
    /** The Server Settings > Experimental switch of that server. The CRM shows only while it is on. */
    const crm = createCrmEnabled(
      createMemo(() => {
        const serverId = crmServerId();
        return serverId === undefined ? undefined : desktopCrmHost(serverId);
      }),
    );
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

    function openWorkflows(serverId: string, source: HTMLElement | null, workflowId?: string) {
      setWorkflowRequest(workflowId === undefined ? undefined : { serverId, workflowId });
      open("workflows", serverId, source);
    }

    function openLibrary(serverId: string, source: HTMLElement | null) {
      open("library", serverId, source);
    }

    function openCrm(serverId: string, source: HTMLElement | null, connectors = false) {
      setCrmConnectorsRequest(connectors ? serverId : undefined);
      open("crm", serverId, source);
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
      setWorkflowRequest(undefined);
      setCrmConnectorsRequest(undefined);
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
      workflowRequest,
      takeWorkflowRequest: () => setWorkflowRequest(undefined),
      openLibrary,
      openCrm,
      /** True when the active server shows its CRM, false when not, and undefined while it is not known. */
      crmEnabled: crm.enabled,
      crmConnectorsRequest,
      takeCrmConnectorsRequest: () => setCrmConnectorsRequest(undefined),
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
