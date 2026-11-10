import type { BackgroundProcess, ClientAgentSummary } from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createEffect, createStore, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import type { FilesPort } from "./files-port";

export interface ServerBackgroundProcessesTarget {
  serverId: string;
  /** False for a member, for this computer, and for a host without `background-processes-v1`. */
  shown: boolean;
}

/**
 * The programs that agents left running on a joined server, with Stop, for an owner or admin. This
 * computer shows its own programs in Settings > Agents. `processes` is null while the list is not
 * shown, and on a Windows host, which does not list its programs.
 */
export function createServerBackgroundProcesses(target: () => ServerBackgroundProcessesTarget, calls: () => FilesPort) {
  const [state, setState] = createStore<{
    processes: BackgroundProcess[] | null;
    agents: ClientAgentSummary[];
    loadFailed: boolean;
    stopping: string[];
  }>({ processes: null, agents: [], loadFailed: false, stopping: [] });
  let generation = 0;

  function load(serverId: string): void {
    const port = untrack(calls).backgroundProcesses;
    if (!port) return;
    const current = ++generation;
    port
      .list(serverId)
      .then((processes) => {
        if (current !== generation) return;
        setState((draft) => {
          draft.processes = processes;
          draft.loadFailed = false;
        });
      })
      .catch(() => {
        if (current !== generation) return;
        setState((draft) => {
          draft.processes = [];
          draft.loadFailed = true;
        });
      });
  }

  // Keyed on the server and on whether it is shown: `target` makes a new object on each read, and a
  // new object would empty the list and read it again with no change.
  const shownServerId = () => {
    const { serverId, shown } = target();
    return shown ? serverId : undefined;
  };
  createEffect(shownServerId, (serverId) => {
    generation++;
    setState((draft) => {
      draft.processes = null;
      draft.agents = [];
      draft.loadFailed = false;
      draft.stopping = [];
    });
    if (serverId === undefined) return;
    load(serverId);
    let current = true;
    untrack(calls)
      .agent.listAgents(serverId)
      .then((agents) => {
        if (current)
          setState((draft) => {
            draft.agents = agents;
          });
      })
      // Without names, each row shows "No agent" and still has Stop.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  });

  function stop(id: string): void {
    const port = calls().backgroundProcesses;
    const { serverId } = target();
    if (!port) return;
    setState((draft) => {
      draft.stopping.push(id);
    });
    port
      .stop(id, serverId)
      .catch((error: unknown) => {
        const { t, errorMessage } = currentText();
        actionToast.error(errorMessage(error, t("settings.backgroundProcesses.stopFailed")), {
          id: "server-background-process-stop-failed",
          report: { operation: "settings", source: "action", cause_code: "unknown" },
        });
      })
      .finally(() => {
        setState((draft) => {
          draft.stopping = draft.stopping.filter((item) => item !== id);
        });
        if (target().serverId === serverId) load(serverId);
      });
  }

  return { state, stop };
}
