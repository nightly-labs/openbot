import type { HostedSiteSummary, HostedSitesDesktopApi } from "@openbot/contracts/ipc";
import { errorMessage } from "@openbot/ui/error-message";
import { createEffect, createStore } from "solid-js";
import { desktopAnalytics } from "../../../analytics";

interface HostedSitesStoreProps {
  open: boolean;
  hostedSitesApi?: HostedSitesDesktopApi;
}

interface HostedSitesPanel {
  busy: boolean;
  error: string | null;
  sites: HostedSiteSummary[];
  /** The site the confirmation dialog asks about. */
  pendingDelete: HostedSiteSummary | null;
  /** A failed deletion, shown in the confirmation dialog so the user can try again or cancel. */
  deleteError: string | null;
}

/** The Hosted sites tab: the published site list, its reload loop and the delete confirmation. */
export function createSettingsHostedSitesStore(props: HostedSitesStoreProps, isActive: () => boolean) {
  const [hosting, setHosting] = createStore<HostedSitesPanel>({
    busy: false,
    error: null,
    sites: [],
    pendingDelete: null,
    deleteError: null,
  });
  let reloadRequested = false;
  let loadPromise: Promise<void> | null = null;

  function load(): Promise<void> {
    if (!props.hostedSitesApi) return Promise.resolve();
    reloadRequested = true;
    if (loadPromise) return loadPromise;
    loadPromise = Promise.resolve().then(async () => {
      try {
        while (reloadRequested) {
          reloadRequested = false;
          setHosting((state) => {
            state.error = null;
          });
          try {
            const api = props.hostedSitesApi;
            if (api) {
              const sites = await api.list();
              setHosting((state) => {
                state.sites = sites;
              });
            }
          } catch (error) {
            setHosting((state) => {
              state.error = errorMessage(error, "Could not load hosted sites.");
            });
          }
        }
      } finally {
        loadPromise = null;
      }
    });
    return loadPromise;
  }

  createEffect(
    () => props.open && isActive(),
    (shouldLoad) => {
      if (shouldLoad) void load();
    },
  );

  function requestDelete(site: HostedSiteSummary): void {
    if (!props.hostedSitesApi || hosting.busy) return;
    setHosting((state) => {
      state.pendingDelete = site;
      state.deleteError = null;
    });
  }

  function cancelDelete(): void {
    if (hosting.busy) return;
    setHosting((state) => {
      state.pendingDelete = null;
      state.deleteError = null;
    });
  }

  /** Deletes the site the dialog asks about. A failed deletion keeps the dialog open with the error. */
  async function confirmDelete(): Promise<void> {
    const site = hosting.pendingDelete;
    if (!props.hostedSitesApi || !site || hosting.busy) return;
    const analytics = desktopAnalytics.scope();
    const siteId = site.id;
    setHosting((state) => {
      state.busy = true;
      state.error = null;
      state.deleteError = null;
    });
    try {
      try {
        await props.hostedSitesApi.delete({ siteId });
      } catch (error) {
        analytics.track("hosted_site_action", {
          action: "delete",
          entry_point: "settings",
          result: "failed",
          failure_code: "delete_failed",
        });
        setHosting((state) => {
          state.deleteError = errorMessage(error, "Could not delete the site.");
        });
        return;
      }
      analytics.track("hosted_site_action", {
        action: "delete",
        entry_point: "settings",
        result: "succeeded",
      });
      setHosting((state) => {
        state.pendingDelete = null;
      });
      await load();
    } catch (error) {
      setHosting((state) => {
        state.error = errorMessage(error, "Could not reload hosted sites.");
      });
    } finally {
      setHosting((state) => {
        state.busy = false;
      });
    }
  }

  return { requestDelete, cancelDelete, confirmDelete, load, state: hosting };
}

export type SettingsHostedSitesStore = ReturnType<typeof createSettingsHostedSitesStore>;
