import type { HostedSiteSummary, HostedSitesDesktopApi } from "@openbot/contracts/ipc";
import { createEffect, createStore } from "solid-js";
import { currentText } from "../../../text";

export type HostedSiteDeleteResult = "succeeded" | "failed";

interface HostedSitesStoreProps {
  open: boolean;
  hostedSitesApi?: Pick<HostedSitesDesktopApi, "list" | "delete"> | undefined;
  /** Called as a deletion starts. It returns the call that records the result, for the account that started it. */
  trackDelete?: () => (result: HostedSiteDeleteResult) => void;
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
              const text = currentText();
              state.error = text.errorMessage(error, text.t("settings.hostedSites.loadFailed"));
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
    const track = props.trackDelete?.();
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
        track?.("failed");
        setHosting((state) => {
          const text = currentText();
          state.deleteError = text.errorMessage(error, text.t("settings.hostedSites.deleteFailed"));
        });
        return;
      }
      track?.("succeeded");
      setHosting((state) => {
        state.pendingDelete = null;
      });
      await load();
    } catch (error) {
      setHosting((state) => {
        const text = currentText();
        state.error = text.errorMessage(error, text.t("settings.hostedSites.reloadFailed"));
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
