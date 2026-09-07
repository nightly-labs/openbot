import type { HostedSiteSummary, HostedSitesDesktopApi } from "@openbot/contracts/ipc";
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
}

/** The Hosted sites tab: the published site list, its reload loop and the delete confirmation. */
export function createSettingsHostedSitesStore(props: HostedSitesStoreProps, isActive: () => boolean) {
  const [hosting, setHosting] = createStore<HostedSitesPanel>({ busy: false, error: null, sites: [] });
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
              state.error = error instanceof Error ? error.message : "Could not load hosted sites.";
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

  async function deleteSite(site: HostedSiteSummary): Promise<void> {
    if (!props.hostedSitesApi || hosting.busy) return;
    if (!window.confirm(`Delete ${site.hostname}? This address will immediately return 410 Gone.`)) return;
    const analytics = desktopAnalytics.scope();
    setHosting((state) => {
      state.busy = true;
      state.error = null;
    });
    try {
      try {
        await props.hostedSitesApi.delete({ siteId: site.id });
      } catch (error) {
        analytics.track("hosted_site_action", {
          action: "delete",
          entry_point: "settings",
          result: "failed",
          failure_code: "delete_failed",
        });
        setHosting((state) => {
          state.error = error instanceof Error ? error.message : "Could not delete the site.";
        });
        return;
      }
      analytics.track("hosted_site_action", {
        action: "delete",
        entry_point: "settings",
        result: "succeeded",
      });
      await load();
    } catch (error) {
      setHosting((state) => {
        state.error = error instanceof Error ? error.message : "Could not reload hosted sites.";
      });
    } finally {
      setHosting((state) => {
        state.busy = false;
      });
    }
  }

  return { deleteSite, load, state: hosting };
}

export type SettingsHostedSitesStore = ReturnType<typeof createSettingsHostedSitesStore>;
