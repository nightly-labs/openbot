import {
  type AgentProviderId,
  agentProviderName,
  isManagedRuntimeProvider,
  MANAGED_RUNTIME_PROVIDERS,
  type ProviderRuntimeSnapshot,
  type ProviderRuntimesDesktopApi,
} from "@openbot/contracts/ipc";
import { errorMessage } from "@openbot/ui/error-message";
import {
  type ProviderUpdate,
  providerUpdateAvailable,
  providerUpdatesToAnnounce,
} from "@openbot/ui/features/provider-updates/provider-update";
import { createEffect, createSignal, flush, onSettled } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { FALLBACK_PROVIDER_RUNTIMES } from "../../app-defaults";
import {
  dismissProviderUpdateToast,
  hideProviderUpdateToast,
  providerUpdateOfferClosed,
  reportProviderUpdateToast,
  showProviderUpdateToast,
} from "./provider-update-toast";

const PROVIDERS = MANAGED_RUNTIME_PROVIDERS;

export interface ProviderCliOwners {
  /** The version of the CLI the user installed for this provider, or `null` for a managed one. */
  systemCliVersion?: (provider: AgentProviderId) => string | null;
  /**
   * Whether the workspace on screen is this computer. Left out, it is.
   *
   * Update offers are announced only for this computer: a notification about a joined server's
   * host would outlive the switch away from it and then name the wrong machine.
   */
  isLocalServer?: () => boolean;
  /**
   * Whether the runtimes `api` reaches belong to the workspace on screen. Left out, it is
   * `isLocalServer`.
   *
   * `window.openbot.providerRuntimes` addresses only this computer, while the agent status beside it
   * describes whichever server is open. An Update button raised for a joined server would then
   * change a runtime the user is not looking at, unless `api` reaches that server's host.
   */
  managesRuntimes?: () => boolean;
}

/**
 * The real download flow, shared by Settings and the other provider controls.
 *
 * `api` is read again when it changes: a joined server's host can be managed only once its
 * capabilities have arrived, which is after this store is built. A change starts from an empty
 * snapshot, so nothing from the previous computer is shown for the next one.
 */
export function createProviderRuntimeStore(
  api: () => ProviderRuntimesDesktopApi | undefined,
  owners: ProviderCliOwners = {},
) {
  const [providerRuntimeSnapshot, setProviderRuntimeSnapshot] =
    createSignal<ProviderRuntimeSnapshot>(FALLBACK_PROVIDER_RUNTIMES);
  const updating = new Set<AgentProviderId>();
  /** What the user was last told about, so one offer is not announced twice. */
  let announced: ProviderUpdate[] = [];
  let disposed = false;
  const isLocalServer = owners.isLocalServer ?? (() => true);
  const managesRuntimes = owners.managesRuntimes ?? isLocalServer;
  function providerUpdate(provider: AgentProviderId, snapshot = providerRuntimeSnapshot()): ProviderUpdate {
    if (!isManagedRuntimeProvider(provider)) throw new Error("OpenBot does not manage this provider's CLI.");
    const runtime = snapshot.providers[provider];
    const systemVersion = owners.systemCliVersion?.(provider) ?? null;
    const availableVersion = runtime.availableVersion ?? null;
    return {
      provider,
      name: agentProviderName(provider),
      runtime:
        systemVersion && runtime.phase !== "ready"
          ? { ...runtime, version: runtime.version ?? systemVersion }
          : runtime,
      availableVersion,
    };
  }

  /**
   * The one thing an Update button does, wherever it is: the provider row, the notification, and the
   * Retry the notification offers after a failure. With no newer version known, it asks for one.
   */
  function startProviderUpdate(provider: AgentProviderId): Promise<void> {
    return runProviderUpdate(provider).catch((error: unknown) => {
      // A user pressed a button, so the outcome belongs on screen. `downloadProviderRuntime`
      // reports its own failures and settles; what reaches here failed before it owned the
      // notification, and was discarded by the caller that started it.
      failProviderUpdate(provider, error);
      throw error;
    });
  }

  function runProviderUpdate(provider: AgentProviderId): Promise<void> {
    if (!managesRuntimes())
      return Promise.reject(new Error("Provider CLI updates run on the computer that hosts them."));
    const update = providerUpdate(provider);
    // A CLI the user installed is not downloaded, but it has a version, and the row offers it the
    // same check as a managed runtime. Only a newer version is a reason to download.
    const installed =
      update.runtime.phase === "ready" ||
      (update.runtime.phase === "not-downloaded" && update.runtime.version !== null);
    if (installed && !providerUpdateAvailable(update.runtime, update.availableVersion)) {
      return checkProviderUpdates(provider);
    }
    return downloadProviderRuntime(provider);
  }

  /**
   * Asks main for the latest release, in the notification the answer then fills: the offer, or
   * "up to date", which counts itself out. A failure reaches `startProviderUpdate`, whose Retry
   * checks again.
   */
  async function checkProviderUpdates(provider: AgentProviderId): Promise<void> {
    const source = api();
    if (!source) throw new Error("Provider updates are unavailable.");
    showProviderUpdateToast({ ...providerUpdate(provider), checking: true }, () => {});
    applyFrom(source, await source.checkForUpdates());
    if (disposed || source !== api()) return;
    const update = providerUpdate(provider);
    if (providerUpdateAvailable(update.runtime, update.availableVersion)) {
      showProviderUpdateToast(update, () => void startProviderUpdate(provider));
    } else {
      reportProviderUpdateToast(update, () => {});
    }
  }

  /** Puts a failure the update never got far enough to report on the notification, with a Retry. */
  function failProviderUpdate(provider: AgentProviderId, error: unknown): void {
    if (disposed) return;
    const update = providerUpdate(provider);
    showProviderUpdateToast(
      {
        ...update,
        runtime: {
          ...update.runtime,
          phase: "download-error",
          message: errorMessage(error, "The update could not start. Try again."),
        },
      },
      () => void startProviderUpdate(provider),
    );
  }

  /** Revisioned, because the pushed event and the awaited call can land out of order. */
  function applyProviderRuntimeSnapshot(snapshot: ProviderRuntimeSnapshot): void {
    if (disposed) return;
    const current = providerRuntimeSnapshot();
    if (snapshot.revision < current.revision) return;
    for (const provider of MANAGED_RUNTIME_PROVIDERS) {
      const previousPhase = current.providers[provider].phase;
      const nextPhase = snapshot.providers[provider].phase;
      if (previousPhase !== "downloading" && previousPhase !== "finishing") continue;
      if (nextPhase === "ready") {
        desktopAnalytics.scope().track("provider_action", {
          provider,
          action: "download_completed",
          result: "succeeded",
        });
      } else if (nextPhase === "download-error") {
        desktopAnalytics.scope().track("provider_action", {
          provider,
          action: "download_completed",
          result: "failed",
          failure_code: "runtime_download_failed",
        });
      }
    }
    setProviderRuntimeSnapshot(snapshot);
    for (const provider of updating) {
      const update = providerUpdate(provider, snapshot);
      if (update.runtime.phase === "not-downloaded" || (update.runtime.phase === "ready" && update.availableVersion))
        continue;
      reportProviderUpdateToast(update, () => void downloadProviderRuntime(provider));
      if (update.runtime.phase !== "downloading" && update.runtime.phase !== "finishing") updating.delete(provider);
    }
  }

  /** Drops an answer that arrives after `api` moved to another computer. */
  function applyFrom(source: ProviderRuntimesDesktopApi, snapshot: ProviderRuntimeSnapshot): void {
    if (source === api()) applyProviderRuntimeSnapshot(snapshot);
  }

  async function downloadProviderRuntime(provider: AgentProviderId): Promise<void> {
    const source = api();
    if (!source) throw new Error("Provider downloads are unavailable.");
    const update = providerUpdate(provider);
    const isUpdate = update.availableVersion !== null;
    if (isUpdate) {
      updating.add(provider);
      showProviderUpdateToast(
        { ...update, runtime: { ...update.runtime, phase: "downloading", progress: 0 } },
        () => void downloadProviderRuntime(provider),
      );
    }
    const analytics = desktopAnalytics.scope();
    analytics.track("provider_action", { provider, action: "download_started", result: "succeeded" });
    try {
      applyFrom(source, await source.download(provider));
    } catch (error) {
      analytics.track("provider_action", {
        provider,
        action: "download_completed",
        result: "failed",
        failure_code: "download_failed",
      });
      if (isUpdate) {
        updating.delete(provider);
        if (!disposed)
          reportProviderUpdateToast(
            {
              ...update,
              runtime: {
                ...update.runtime,
                phase: "download-error",
                message: "The update could not start. Try again.",
              },
            },
            () => void downloadProviderRuntime(provider),
          );
        return;
      }
      throw error;
    }
  }

  async function cancelProviderRuntimeDownload(provider: AgentProviderId): Promise<void> {
    const source = api();
    if (!source) throw new Error("Provider downloads are unavailable.");
    const snapshot = await source.cancel(provider);
    updating.delete(provider);
    dismissProviderUpdateToast(provider);
    applyFrom(source, snapshot);
    desktopAnalytics.scope().track("provider_action", {
      provider,
      action: "download_cancelled",
      result: "succeeded",
    });
  }

  /**
   * Raises one notification for each provider that has just gained an update offer.
   *
   * An effect, not a call at the end of each update: an offer is a fact about two pieces of state
   * that arrive separately and in no fixed order - the runtime snapshot from main, and the agent
   * status that names the version of a CLI the user installed. Announcing from whichever one landed
   * last missed the offer whenever the other was still on its way.
   *
   * Only the crossing into "update available" is announced, so a snapshot pushed for an unrelated
   * provider - and every progress tick is one - leaves a dismissed notification dismissed.
   */
  createEffect(
    () => (isLocalServer() ? PROVIDERS.map((provider) => providerUpdate(provider)) : null),
    (next) => {
      // A remote workspace announces nothing, and leaves the record of what was announced alone:
      // it says what the user was told about this computer, which the open server does not change.
      if (!next) return;
      for (const update of providerUpdatesToAnnounce(announced, next)) {
        // A closed notification stays closed, including across the server switch that rebuilds this
        // store: the record of it is kept by the notification module, which outlives the switch.
        if (providerUpdateOfferClosed(update.provider, update.availableVersion)) continue;
        showProviderUpdateToast(update, () => void startProviderUpdate(update.provider));
      }
      announced = next;
    },
  );

  createEffect(api, (source, previous) => {
    if (previous !== undefined) {
      // Another computer: its revisions count from its own start, and nothing shown so far is its.
      updating.clear();
      for (const provider of MANAGED_RUNTIME_PROVIDERS) hideProviderUpdateToast(provider);
      setProviderRuntimeSnapshot(FALLBACK_PROVIDER_RUNTIMES);
    }
    if (!source) return;
    const unsubscribe = source.onEvent((snapshot) => flush(() => applyFrom(source, snapshot)));
    source
      .getStatus()
      .then((snapshot) => applyFrom(source, snapshot))
      .catch(() => undefined);
    return unsubscribe;
  });

  onSettled(() => {
    return () => {
      disposed = true;
      updating.clear();
      // Hidden, not dismissed: the offer outlives the workspace this store was built for.
      for (const provider of MANAGED_RUNTIME_PROVIDERS) hideProviderUpdateToast(provider);
    };
  });
  return {
    providerRuntimeStatuses: () => providerRuntimeSnapshot().providers,
    /**
     * The runtimes the MCP servers are started with, which no provider card shows. They belong to
     * the computer `api` reaches, so a reader that draws them for a server checks that it is that
     * computer.
     */
    toolRuntimeStatuses: () => providerRuntimeSnapshot().toolRuntimes,
    providerAvailableVersions: () => ({
      codex: providerUpdate("codex").availableVersion,
      claude: providerUpdate("claude").availableVersion,
      grok: providerUpdate("grok").availableVersion,
    }),
    providerRuntimeDownloadsAvailable: () => Boolean(api()),
    applyProviderRuntimeSnapshot,
    startProviderUpdate,
    downloadProviderRuntime,
    cancelProviderRuntimeDownload,
  };
}
