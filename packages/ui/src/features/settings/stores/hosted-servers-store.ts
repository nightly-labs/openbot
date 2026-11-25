import type {
  HostedServerLifecycleInput,
  HostedServerState,
  HostedServerSummary,
} from "@openbot/contracts/hosted-servers";
import type { HostedServersDesktopApi } from "@openbot/contracts/ipc";
import { createEffect, createStore, untrack } from "solid-js";
import { currentText } from "../../../text";

const TRANSITION_STATES: ReadonlySet<HostedServerState> = new Set([
  "awaiting_payment",
  "creating",
  "starting",
  "stopping",
  "waking",
]);
const TRANSITION_REFRESH_INTERVAL_MS = 5_000;

interface HostedServersStoreProps {
  open: boolean;
  hostedServersApi?: HostedServersDesktopApi | undefined;
}

interface HostedServersPanel {
  available: boolean;
  lifecycleAvailable: boolean;
  loaded: boolean;
  error: string | null;
  servers: HostedServerSummary[];
  wakingServerId: string | null;
  checkoutServerId: string | null;
  pendingDelete: HostedServerSummary | null;
  deleteConfirmName: string;
  deleting: boolean;
  deleteError: string | null;
}

export function createSettingsHostedServersStore(props: HostedServersStoreProps, isActive: () => boolean) {
  const [panel, setPanel] = createStore<HostedServersPanel>({
    available: false,
    lifecycleAvailable: false,
    loaded: false,
    error: null,
    servers: [],
    wakingServerId: null,
    checkoutServerId: null,
    pendingDelete: null,
    deleteConfirmName: "",
    deleting: false,
    deleteError: null,
  });
  let loadRevision = 0;
  let reloading = false;
  let deleteRequestId: string | null = null;

  async function load(): Promise<void> {
    const api = props.hostedServersApi;
    if (!api) return;
    const revision = ++loadRevision;
    try {
      const list = await api.list();
      if (revision !== loadRevision) return;
      setPanel((state) => {
        state.available = list.available;
        state.lifecycleAvailable = list.lifecycleAvailable === true;
        state.servers = list.servers;
        state.loaded = true;
        state.error = null;
      });
      const requested = deleteRequestId;
      deleteRequestId = null;
      const server = requested ? list.servers.find((entry) => entry.serverId === requested) : undefined;
      if (server) requestDelete(server);
    } catch (error) {
      if (revision !== loadRevision) return;
      deleteRequestId = null;
      setPanel((state) => {
        const text = currentText();
        state.error = text.errorMessage(error, text.t("settings.hostedServers.loadFailed"));
      });
    }
  }

  createEffect(
    () => props.open && Boolean(props.hostedServersApi),
    (shouldLoad) => {
      if (shouldLoad) void untrack(load);
      else deleteRequestId = null;
    },
  );

  function reload(): void {
    if (reloading) return;
    reloading = true;
    void load().finally(() => {
      reloading = false;
    });
  }

  createEffect(
    () => props.open && isActive() && panel.servers.some((server) => TRANSITION_STATES.has(server.state)),
    (shouldPoll) => {
      if (!shouldPoll) return;
      const timer = window.setInterval(reload, TRANSITION_REFRESH_INTERVAL_MS);
      return () => window.clearInterval(timer);
    },
  );

  createEffect(
    () => props.open && isActive() && Boolean(props.hostedServersApi),
    (shown) => {
      if (!shown) return;
      const reloadVisible = () => {
        if (document.visibilityState !== "hidden") reload();
      };
      window.addEventListener("focus", reloadVisible);
      document.addEventListener("visibilitychange", reloadVisible);
      return () => {
        window.removeEventListener("focus", reloadVisible);
        document.removeEventListener("visibilitychange", reloadVisible);
      };
    },
  );

  async function wake(server: HostedServerSummary): Promise<void> {
    const api = props.hostedServersApi;
    if (!api || panel.wakingServerId) return;
    setPanel((state) => {
      state.wakingServerId = server.serverId;
      state.error = null;
    });
    try {
      const woken = await api.wake(server.serverId);
      setPanel((state) => {
        state.servers = state.servers.map((entry) => (entry.serverId === woken.serverId ? woken : entry));
      });
    } catch (error) {
      setPanel((state) => {
        const text = currentText();
        state.error = text.errorMessage(error, text.t("settings.hostedServers.wakeFailed"));
      });
    } finally {
      setPanel((state) => {
        state.wakingServerId = null;
      });
    }
  }

  async function openCheckout(server: HostedServerSummary): Promise<void> {
    const api = props.hostedServersApi;
    if (!api || panel.checkoutServerId) return;
    setPanel((state) => {
      state.checkoutServerId = server.serverId;
      state.error = null;
    });
    try {
      const updated = await api.openCheckout(server.serverId);
      setPanel((state) => {
        state.servers = state.servers.map((entry) => (entry.serverId === updated.serverId ? updated : entry));
      });
    } catch (error) {
      setPanel((state) => {
        const text = currentText();
        state.error = text.errorMessage(error, text.t("settings.hostedServers.checkoutFailed"));
      });
    } finally {
      setPanel((state) => {
        state.checkoutServerId = null;
      });
    }
  }

  function requestDelete(server: HostedServerSummary): void {
    if (!props.hostedServersApi || panel.deleting) return;
    setPanel((state) => {
      state.pendingDelete = server;
      state.deleteConfirmName = "";
      state.deleteError = null;
    });
  }

  function requestDeleteById(serverId: string): void {
    deleteRequestId = serverId;
    void load();
  }

  function setDeleteConfirmName(value: string): void {
    setPanel((state) => {
      state.deleteConfirmName = value;
      state.deleteError = null;
    });
  }

  function cancelDelete(): void {
    if (panel.deleting) return;
    setPanel((state) => {
      state.pendingDelete = null;
      state.deleteConfirmName = "";
      state.deleteError = null;
    });
  }

  const deleteConfirmed = () =>
    panel.pendingDelete !== null && panel.deleteConfirmName.trim() === panel.pendingDelete.name;

  async function confirmDelete(): Promise<void> {
    const api = props.hostedServersApi;
    const server = panel.pendingDelete;
    if (!api || !server || panel.deleting) return;
    if (!deleteConfirmed()) {
      setPanel((state) => {
        state.deleteError = currentText().t("settings.hostedServers.deleteNameMismatch");
      });
      return;
    }
    setPanel((state) => {
      state.deleting = true;
      state.deleteError = null;
    });
    try {
      await api.delete({ serverId: server.serverId, confirmName: panel.deleteConfirmName.trim() });
      setPanel((state) => {
        state.servers = state.servers.filter((entry) => entry.serverId !== server.serverId);
        state.pendingDelete = null;
        state.deleteConfirmName = "";
      });
      await load();
    } catch (error) {
      setPanel((state) => {
        const text = currentText();
        state.deleteError = text.errorMessage(error, text.t("settings.hostedServers.deleteFailed"));
      });
    } finally {
      setPanel((state) => {
        state.deleting = false;
      });
    }
  }

  async function lifecycle(input: HostedServerLifecycleInput): Promise<void> {
    const api = props.hostedServersApi;
    if (!api) throw new Error(currentText().t("billing.unavailable"));
    await api.lifecycle(input);
    await load();
  }

  return {
    lifecycle,
    state: panel,
    load,
    wake,
    openCheckout,
    requestDelete,
    requestDeleteById,
    setDeleteConfirmName,
    cancelDelete,
    confirmDelete,
    deleteConfirmed,
  };
}

export type SettingsHostedServersStore = ReturnType<typeof createSettingsHostedServersStore>;
