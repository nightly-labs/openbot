import { CRM_CAPABILITY } from "@openbot/contracts/team-protocol/crm-v1";
import { createEffect, createMemo, createSignal, createStore, untrack } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { createCrmEnabled } from "../crm/crm-enabled";
import { desktopCrmHost } from "../crm/crm-port";
import { serverCanAdminister } from "../servers/server-capabilities";
import { useServers } from "../servers/servers-context";

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
    const [workflowRequest, setWorkflowRequest] = createSignal<{ serverId: string; workflowId: string }>();
    const [crmConnectorsRequest, setCrmConnectorsRequest] = createSignal<string>();
    const { activeServer, activeServerId } = useServers();
    const crmServerId = createMemo(() => {
      const server = activeServer();
      return serverCanAdminister(server, CRM_CAPABILITY) ? server.id : undefined;
    });
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
      crmEnabled: crm.enabled,
      crmConnectorsRequest,
      takeCrmConnectorsRequest: () => setCrmConnectorsRequest(undefined),
      closeUsage() {
        clear();
        queueMicrotask(() => {
          if (trigger?.isConnected) trigger.focus({ preventScroll: true });
        });
      },
      dismissUsage: clear,
    };
  },
});
export const UsageProvider = context.provider;
export const useUsage = context.use;
