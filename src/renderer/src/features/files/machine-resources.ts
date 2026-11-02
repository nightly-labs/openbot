import type { MachineAlertSettings, MachineMetrics } from "@openbot/contracts/ipc";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import type { FilesPort } from "./files-port";

/** Disk and memory change slowly, and the host reads CPU since the reading before. */
const MACHINE_REFRESH_MS = 60_000;

/** Machine use and its alerts are hidden for now: in Storage and in the sidebar card. */
export const MACHINE_RESOURCES_SHOWN: boolean = false;

/**
 * The machine use of one server and its alert settings, for an owner or admin. It reads again each
 * minute while Storage is open. `available` is false for a member, for a client with no machine
 * calls, and for a host without `machine-resources-v1`.
 */
export function createMachineResources(target: () => { serverId: string; canManage: boolean }, calls: () => FilesPort) {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<{
    available: boolean;
    metrics: MachineMetrics | null;
    alerts: MachineAlertSettings | null;
    error: string | null;
  }>({ available: false, metrics: null, alerts: null, error: null });

  createEffect(target, ({ serverId, canManage }) => {
    if (!MACHINE_RESOURCES_SHOWN) return;
    const port = untrack(calls);
    const read = port.storage.getMachineMetrics;
    const admin = port.hostAdmin;
    setState((draft) => {
      draft.available = canManage && read !== undefined && admin !== undefined;
      draft.metrics = null;
      draft.alerts = null;
      draft.error = null;
    });
    if (!canManage || !read || !admin) return;
    let current = true;
    const refresh = () =>
      read(serverId)
        .then((metrics) => {
          if (!current) return;
          setState((draft) => {
            draft.available = metrics !== null;
            draft.metrics = metrics;
            draft.error = null;
          });
        })
        .catch((error: unknown) => {
          if (!current) return;
          setState((draft) => {
            draft.error = errorMessage(error, t("files.machine.readFailed"));
          });
        });
    void refresh();
    admin
      .getMachineAlerts(serverId)
      .then((alerts) => {
        if (current)
          setState((draft) => {
            draft.alerts = alerts;
          });
      })
      // The machine part still shows the use; only the alert settings stay hidden.
      .catch(() => undefined);
    const timer = setInterval(() => void refresh(), MACHINE_REFRESH_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  });

  // The settings show at once, so a second change in a row builds on the first, and the requests go
  // to the host one at a time, in order. Only the answer to the newest request replaces the settings.
  let queue: Promise<unknown> = Promise.resolve();
  let latest = 0;
  async function saveAlerts(settings: MachineAlertSettings): Promise<void> {
    const admin = calls().hostAdmin;
    if (!admin) return;
    const { serverId } = target();
    const request = ++latest;
    setState((draft) => {
      draft.alerts = settings;
    });
    const save = queue.then(() => admin.setMachineAlerts(settings, serverId));
    queue = save.catch(() => undefined);
    try {
      const saved = await save;
      if (request === latest && target().serverId === serverId)
        setState((draft) => {
          draft.alerts = saved;
        });
    } catch (error) {
      actionToast.error(errorMessage(error, t("files.machine.saveFailed")));
      // The panel shows what the host keeps, not the change that failed.
      if (request === latest && target().serverId === serverId)
        admin
          .getMachineAlerts(serverId)
          .then((alerts) => {
            if (request === latest && target().serverId === serverId)
              setState((draft) => {
                draft.alerts = alerts;
              });
          })
          .catch(() => undefined);
    }
  }

  return { state, saveAlerts };
}
