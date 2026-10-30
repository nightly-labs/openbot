import {
  type AgentProviderId,
  agentProviderName,
  isManagedRuntimeProvider,
  MANAGED_RUNTIME_PROVIDERS,
  type ProviderRuntimeSnapshot,
  type ProviderRuntimesDesktopApi,
} from "@openbot/contracts/ipc";
import { matchingSourceKeys } from "@openbot/i18n";
import {
  type ProviderUpdate,
  providerUpdateAvailable,
  providerUpdatesToAnnounce,
} from "@openbot/ui/features/provider-updates/provider-update";
import { currentText } from "@openbot/ui/text";
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

/**
 * The runtime calls a joined server's host serves too. Removing a download is this computer's only,
 * so the store does not need it.
 */
export type ProviderRuntimeSource = Omit<ProviderRuntimesDesktopApi, "measureDownload" | "removeDownload">;

/** The analytics code of each catalog reason that the runtime manager shows for a failed download. */
const DOWNLOAD_FAILURE_CODES: Readonly<Record<string, string>> = {
  "error.provider.diskSpace": "disk_space",
  "error.provider.downloadHttp": "download_http",
  "error.provider.downloadIntegrity": "download_integrity",
  "error.provider.downloadSize": "download_size",
  "error.provider.claudeArchivePath": "archive_invalid",
  "error.provider.claudePackageMismatch": "archive_invalid",
  "error.provider.claudeChecksum": "checksum_failed",
  "error.provider.runtimeChecksum": "checksum_failed",
  "error.provider.installRecordMismatch": "checksum_failed",
  "error.provider.unexpectedVersion": "version_mismatch",
  "error.provider.cliUpdateFailed": "cli_update_failed",
  "error.provider.cliActivateFailed": "cli_activate_failed",
  "error.provider.cliSelectFailed": "cli_select_failed",
  "error.provider.cliSigningIn": "cli_signing_in",
  "error.provider.off": "provider_off",
  "status.provider.downloadStopped": "download_stopped",
};

/** The status message holds catalog text only, so its key names the reason without a path or a secret. */
function downloadFailureCode(message: string | null): string {
  const key = message === null ? undefined : matchingSourceKeys(message)[0];
  return (key && DOWNLOAD_FAILURE_CODES[key]) ?? "runtime_download_failed";
}

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
  api: () => ProviderRuntimeSource | undefined,
  owners: ProviderCliOwners = {},
) {
  const [providerRuntimeSnapshot, setProviderRuntimeSnapshot] =
    createSignal<ProviderRuntimeSnapshot>(FALLBACK_PROVIDER_RUNTIMES);
  const updating = new Set<AgentProviderId>();
  /**
   * Providers whose notification says the update failed. A failure is held on screen, and nothing
   * reports to it once the update has let go of it, so it is taken down here when a later snapshot
   * shows the runtime current: a sibling instance installed it, or a Retry elsewhere did.
   */
  const failed = new Set<AgentProviderId>();
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
    if (!managesRuntimes()) return Promise.reject(new Error(currentText().t("update.provider.remoteHost")));
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
    if (!source) throw new Error(currentText().t("update.provider.unavailable"));
    failed.delete(provider);
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
          message: currentText().errorMessage(error, currentText().t("update.provider.startFailed")),
        },
      },
      () => void startProviderUpdate(provider),
    );
    failed.add(provider);
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
          failure_code: downloadFailureCode(snapshot.providers[provider].message),
        });
      }
    }
    setProviderRuntimeSnapshot(snapshot);
    // Main updates the managed CLIs on its own after an app upgrade, with no notification. Only
    // its failure is shown, with a Retry. A first install has no version and shows its own failure.
    // The crossing into the failure, not out of a download: an update that fails at once can fail
    // before the window gets its first snapshot.
    for (const provider of MANAGED_RUNTIME_PROVIDERS) {
      if (updating.has(provider) || !isLocalServer()) continue;
      const next = snapshot.providers[provider];
      if (next.phase !== "download-error" || next.version === null) continue;
      if (current.providers[provider].phase === "download-error") continue;
      showProviderUpdateToast(providerUpdate(provider, snapshot), () => void downloadProviderRuntime(provider));
      failed.add(provider);
    }
    for (const provider of updating) {
      const update = providerUpdate(provider, snapshot);
      if (update.runtime.phase === "not-downloaded" || (update.runtime.phase === "ready" && update.availableVersion))
        continue;
      reportProviderUpdateToast(update, () => void downloadProviderRuntime(provider));
      // The report replaced whatever the notification said before, a failure included.
      if (update.runtime.phase === "download-error") failed.add(provider);
      else failed.delete(provider);
      if (update.runtime.phase !== "downloading" && update.runtime.phase !== "finishing") updating.delete(provider);
    }
    for (const provider of failed) {
      if (updating.has(provider) || !isManagedRuntimeProvider(provider)) continue;
      const previous = current.providers[provider];
      const next = snapshot.providers[provider];
      // Only the crossing into a current runtime: a failed check leaves a runtime that was ready
      // ready, and the next unrelated snapshot must not take that failure away.
      if (next.phase !== "ready" || next.availableVersion) continue;
      if (previous.phase === "ready" && previous.version === next.version) continue;
      failed.delete(provider);
      hideProviderUpdateToast(provider);
    }
  }

  /** Drops an answer that arrives after `api` moved to another computer. */
  function applyFrom(source: ProviderRuntimeSource, snapshot: ProviderRuntimeSnapshot): void {
    if (source === api()) applyProviderRuntimeSnapshot(snapshot);
  }

  async function downloadProviderRuntime(provider: AgentProviderId): Promise<void> {
    // A custom agent is the user's own command: OpenBot downloads nothing for it.
    if (!isManagedRuntimeProvider(provider)) return;
    const source = api();
    if (!source) throw new Error(currentText().t("update.provider.downloadsUnavailable"));
    const update = providerUpdate(provider);
    const isUpdate = update.availableVersion !== null;
    if (isUpdate) {
      updating.add(provider);
      failed.delete(provider);
      showProviderUpdateToast(
        { ...update, runtime: { ...update.runtime, phase: "downloading", progress: 0, message: null } },
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
                message: currentText().t("update.provider.startFailed"),
              },
            },
            () => void downloadProviderRuntime(provider),
          );
        failed.add(provider);
        return;
      }
      throw error;
    }
  }

  async function cancelProviderRuntimeDownload(provider: AgentProviderId): Promise<void> {
    // A custom agent is the user's own command: OpenBot downloads nothing for it.
    if (!isManagedRuntimeProvider(provider)) return;
    const source = api();
    if (!source) throw new Error(currentText().t("update.provider.downloadsUnavailable"));
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
      // An offer that main takes back with no update running, as for a provider the user turned off,
      // takes its notification down: its Update button could only say "up to date".
      for (const update of next) {
        const previous = announced.find((entry) => entry.provider === update.provider);
        if (!previous || !providerUpdateAvailable(previous.runtime, previous.availableVersion)) continue;
        if (update.availableVersion !== null || updating.has(update.provider) || failed.has(update.provider)) continue;
        if (update.runtime.phase === "ready" || update.runtime.phase === "not-downloaded")
          hideProviderUpdateToast(update.provider);
      }
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
      failed.clear();
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
    // Every managed provider, so a row and the notification agree that an update is available.
    providerAvailableVersions: () =>
      Object.fromEntries(PROVIDERS.map((provider) => [provider, providerUpdate(provider).availableVersion])),
    providerRuntimeDownloadsAvailable: () => Boolean(api()),
    applyProviderRuntimeSnapshot,
    startProviderUpdate,
    downloadProviderRuntime,
    cancelProviderRuntimeDownload,
  };
}
