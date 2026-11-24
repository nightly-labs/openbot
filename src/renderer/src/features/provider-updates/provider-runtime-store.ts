import {
  type AgentProviderId,
  agentProviderName,
  INSTALLER_PROVIDERS,
  isInstallerProvider,
  isManagedRuntimeProvider,
  MANAGED_RUNTIME_PROVIDERS,
  type ProviderRuntimeSnapshot,
  type ProviderRuntimeStatus,
  type ProviderRuntimesDesktopApi,
  type ServerSummary,
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
const DOWNLOADABLE_PROVIDERS = [...MANAGED_RUNTIME_PROVIDERS, ...INSTALLER_PROVIDERS];

function downloadRuns(status: ProviderRuntimeStatus | undefined): boolean {
  return status?.phase === "downloading" || status?.phase === "finishing";
}

export type ProviderRuntimeSource = Omit<ProviderRuntimesDesktopApi, "measureDownload" | "removeDownload">;

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
  "error.provider.cpuUnsupported": "cpu_unsupported",
  "error.provider.windowsBlocked": "windows_blocked",
  "error.provider.cliUpdateFailed": "cli_update_failed",
  "error.provider.cliActivateFailed": "cli_activate_failed",
  "error.provider.cliNewVersionNotStarted": "cli_activate_failed",
  "error.provider.cliSelectFailed": "cli_select_failed",
  "error.provider.cliSigningIn": "cli_signing_in",
  "error.provider.off": "provider_off",
  "status.provider.downloadStopped": "download_stopped",
  "error.provider.hermesInstallFailed": "hermes_install_failed",
  "error.provider.hermesNeedsGitCurl": "hermes_prerequisites",
};

function downloadFailureCode(message: string | null): string {
  const key = message === null ? undefined : matchingSourceKeys(message)[0];
  return (key && DOWNLOAD_FAILURE_CODES[key]) ?? "runtime_download_failed";
}

export function hostConnection(server: ServerSummary | undefined): number | undefined {
  return server?.kind === "remote" && server.state === "online" ? (server.connectionSequence ?? 0) : undefined;
}

export interface ProviderCliOwners {
  systemCliVersion?: (provider: AgentProviderId, runtime: ProviderRuntimeStatus) => string | null;
  isLocalServer?: () => boolean;
  managesRuntimes?: () => boolean;
  hostConnection?: () => number | undefined;
}

export function createProviderRuntimeStore(
  api: () => ProviderRuntimeSource | undefined,
  owners: ProviderCliOwners = {},
) {
  const [providerRuntimeSnapshot, setProviderRuntimeSnapshot] =
    createSignal<ProviderRuntimeSnapshot>(FALLBACK_PROVIDER_RUNTIMES);
  const updating = new Set<AgentProviderId>();
  const failed = new Set<AgentProviderId>();
  const installing = new Set<AgentProviderId>();
  let announced: ProviderUpdate[] = [];
  let disposed = false;
  let hostReconnected = false;
  const isLocalServer = owners.isLocalServer ?? (() => true);
  const managesRuntimes = owners.managesRuntimes ?? isLocalServer;
  function providerUpdate(provider: AgentProviderId, snapshot = providerRuntimeSnapshot()): ProviderUpdate {
    if (!isManagedRuntimeProvider(provider)) throw new Error("OpenBot does not manage this provider's CLI.");
    const runtime = snapshot.providers[provider];
    const systemVersion = owners.systemCliVersion?.(provider, runtime) ?? null;
    const availableVersion = runtime.availableVersion ?? null;
    return {
      provider,
      name: agentProviderName(provider),
      runtime:
        systemVersion && runtime.phase !== "ready"
          ? { ...runtime, version: runtime.version ?? systemVersion }
          : runtime,
      availableVersion,
      ...(installing.has(provider) ? { install: true } : {}),
    };
  }

  function runtimeStatus(
    provider: AgentProviderId,
    snapshot: ProviderRuntimeSnapshot,
  ): ProviderRuntimeStatus | undefined {
    if (isManagedRuntimeProvider(provider)) return snapshot.providers[provider];
    return isInstallerProvider(provider) ? snapshot.providers[provider] : undefined;
  }

  function downloadUpdate(provider: AgentProviderId, snapshot = providerRuntimeSnapshot()): ProviderUpdate | null {
    if (isManagedRuntimeProvider(provider)) return providerUpdate(provider, snapshot);
    const runtime = runtimeStatus(provider, snapshot);
    if (!runtime) return null;
    return { provider, name: agentProviderName(provider), runtime, availableVersion: null, install: true };
  }

  function startProviderUpdate(provider: AgentProviderId): Promise<void> {
    return runProviderUpdate(provider).catch((error: unknown) => {
      failProviderUpdate(provider, error);
      throw error;
    });
  }

  function runProviderUpdate(provider: AgentProviderId): Promise<void> {
    if (!managesRuntimes()) return Promise.reject(new Error(currentText().t("update.provider.remoteHost")));
    const update = providerUpdate(provider);
    const installed =
      update.runtime.phase === "ready" ||
      (update.runtime.phase === "not-downloaded" && update.runtime.version !== null);
    if (installed && !providerUpdateAvailable(update.runtime, update.availableVersion)) {
      return checkProviderUpdates(provider);
    }
    return downloadProviderRuntime(provider);
  }

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

  function applyProviderRuntimeSnapshot(snapshot: ProviderRuntimeSnapshot): void {
    if (disposed) return;
    const current = providerRuntimeSnapshot();
    if (snapshot.revision < current.revision && !hostReconnected) return;
    hostReconnected = false;
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
    for (const provider of INSTALLER_PROVIDERS) {
      const previousPhase = current.providers[provider]?.phase;
      if (previousPhase !== "downloading" && previousPhase !== "finishing") continue;
      const next = snapshot.providers[provider];
      if (!next || next.phase === "downloading" || next.phase === "finishing" || next.phase === "not-downloaded")
        continue;
      desktopAnalytics.scope().track("provider_action", {
        provider,
        action: "download_completed",
        ...(next.phase === "download-error"
          ? { result: "failed", failure_code: downloadFailureCode(next.message) }
          : { result: "succeeded" }),
      });
    }
    setProviderRuntimeSnapshot(snapshot);
    for (const provider of MANAGED_RUNTIME_PROVIDERS) {
      if (updating.has(provider) || !isLocalServer()) continue;
      const next = snapshot.providers[provider];
      if (next.phase !== "download-error" || next.version === null) continue;
      if (current.providers[provider].phase === "download-error") continue;
      showProviderUpdateToast(providerUpdate(provider, snapshot), () => retryDownload(provider));
      failed.add(provider);
    }
    for (const provider of MANAGED_RUNTIME_PROVIDERS) {
      if (updating.has(provider)) continue;
      if (downloadRuns(current.providers[provider]) || !downloadRuns(snapshot.providers[provider])) continue;
      const update = providerUpdate(provider, snapshot);
      if (update.runtime.version !== null) continue;
      installing.add(provider);
      updating.add(provider);
      failed.delete(provider);
      showProviderUpdateToast({ ...update, install: true }, () => retryDownload(provider));
    }
    for (const provider of updating) {
      const update = downloadUpdate(provider, snapshot);
      const stopped =
        installing.has(provider) &&
        update?.runtime.phase === "not-downloaded" &&
        downloadRuns(runtimeStatus(provider, current));
      if (!update || stopped) {
        updating.delete(provider);
        installing.delete(provider);
        dismissProviderUpdateToast(provider);
        continue;
      }
      if (update.runtime.phase === "not-downloaded" || (update.runtime.phase === "ready" && update.availableVersion))
        continue;
      reportProviderUpdateToast(update, () => retryDownload(provider));
      if (update.runtime.phase === "download-error") failed.add(provider);
      else failed.delete(provider);
      if (update.runtime.phase !== "downloading" && update.runtime.phase !== "finishing") {
        updating.delete(provider);
        if (update.runtime.phase !== "download-error") installing.delete(provider);
      }
    }
    for (const provider of failed) {
      if (updating.has(provider)) continue;
      const previous = runtimeStatus(provider, current);
      const next = runtimeStatus(provider, snapshot);
      if (next?.phase !== "ready" || next.availableVersion) continue;
      if (previous?.phase === "ready" && previous.version === next.version) continue;
      failed.delete(provider);
      installing.delete(provider);
      hideProviderUpdateToast(provider);
    }
  }

  function refreshProviderRuntimes(): void {
    const source = api();
    if (!source) return;
    source
      .getStatus()
      .then((snapshot) => applyFrom(source, snapshot))
      .catch(() => undefined);
  }

  function applyFrom(source: ProviderRuntimeSource, snapshot: ProviderRuntimeSnapshot): void {
    if (source === api()) applyProviderRuntimeSnapshot(snapshot);
  }

  function retryDownload(provider: AgentProviderId): void {
    void downloadProviderRuntime(provider).catch(() => undefined);
  }

  async function downloadProviderRuntime(provider: AgentProviderId): Promise<void> {
    if (!isManagedRuntimeProvider(provider) && !isInstallerProvider(provider)) return;
    const source = api();
    if (!source) throw new Error(currentText().t("update.provider.downloadsUnavailable"));
    if (downloadUpdate(provider)?.runtime.version === null) installing.add(provider);
    else installing.delete(provider);
    const update = downloadUpdate(provider);
    const isUpdate = update !== null && (update.availableVersion !== null || update.install === true);
    if (update && isUpdate) {
      updating.add(provider);
      failed.delete(provider);
      showProviderUpdateToast(
        { ...update, runtime: { ...update.runtime, phase: "downloading", progress: 0, message: null } },
        () => retryDownload(provider),
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
      if (update && isUpdate) {
        updating.delete(provider);
        if (!disposed)
          reportProviderUpdateToast(
            {
              ...update,
              runtime: {
                ...update.runtime,
                phase: "download-error",
                message: update.install
                  ? currentText().errorMessage(error, currentText().t("update.provider.downloadFailedRetry"))
                  : currentText().t("update.provider.startFailed"),
              },
            },
            () => retryDownload(provider),
          );
        failed.add(provider);
        if (update.install) throw error;
        return;
      }
      throw error;
    }
  }

  async function cancelProviderRuntimeDownload(provider: AgentProviderId): Promise<void> {
    if (!isManagedRuntimeProvider(provider) && !isInstallerProvider(provider)) return;
    const source = api();
    if (!source) throw new Error(currentText().t("update.provider.downloadsUnavailable"));
    const snapshot = await source.cancel(provider);
    updating.delete(provider);
    installing.delete(provider);
    dismissProviderUpdateToast(provider);
    applyFrom(source, snapshot);
    desktopAnalytics.scope().track("provider_action", {
      provider,
      action: "download_cancelled",
      result: "succeeded",
    });
  }

  createEffect(
    () => (isLocalServer() ? PROVIDERS.map((provider) => providerUpdate(provider)) : null),
    (next) => {
      if (!next) return;
      for (const update of next) {
        const previous = announced.find((entry) => entry.provider === update.provider);
        if (!previous || !providerUpdateAvailable(previous.runtime, previous.availableVersion)) continue;
        if (update.availableVersion !== null || updating.has(update.provider) || failed.has(update.provider)) continue;
        if (update.runtime.phase === "ready" || update.runtime.phase === "not-downloaded")
          hideProviderUpdateToast(update.provider);
      }
      for (const update of providerUpdatesToAnnounce(announced, next)) {
        if (providerUpdateOfferClosed(update.provider, update.availableVersion)) continue;
        showProviderUpdateToast(update, () => void startProviderUpdate(update.provider));
      }
      announced = next;
    },
  );

  createEffect(api, (source, previous) => {
    if (previous !== undefined) {
      updating.clear();
      failed.clear();
      installing.clear();
      for (const provider of DOWNLOADABLE_PROVIDERS) hideProviderUpdateToast(provider);
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

  let firstConnection = true;
  createEffect(
    () => owners.hostConnection?.(),
    (connection) => {
      const first = firstConnection;
      firstConnection = false;
      if (first || connection === undefined) return;
      hostReconnected = true;
      refreshProviderRuntimes();
    },
  );

  onSettled(() => {
    return () => {
      disposed = true;
      updating.clear();
      for (const provider of DOWNLOADABLE_PROVIDERS) hideProviderUpdateToast(provider);
    };
  });
  return {
    providerRuntimeStatuses: () => providerRuntimeSnapshot().providers,
    toolRuntimeStatuses: () => providerRuntimeSnapshot().toolRuntimes,
    providerAvailableVersions: () =>
      Object.fromEntries(PROVIDERS.map((provider) => [provider, providerUpdate(provider).availableVersion])),
    providerRuntimeDownloadsAvailable: () => Boolean(api()),
    applyProviderRuntimeSnapshot,
    refreshProviderRuntimes,
    startProviderUpdate,
    downloadProviderRuntime,
    cancelProviderRuntimeDownload,
  };
}
