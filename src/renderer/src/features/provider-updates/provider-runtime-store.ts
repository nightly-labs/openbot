import type { AgentProviderId, ProviderRuntimeSnapshot, ProviderRuntimesDesktopApi } from "@openbot/contracts/ipc";
import { createSignal, flush, onSettled } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { FALLBACK_PROVIDER_RUNTIMES } from "../../app-defaults";
import type { ProviderUpdate } from "./provider-update";
import {
  dismissProviderUpdateToast,
  reportProviderUpdateToast,
  showProviderUpdateToast,
} from "./provider-update-toast";

/** The real download flow, shared by Settings and the other local provider controls. */
export function createProviderRuntimeStore(api: ProviderRuntimesDesktopApi | undefined) {
  const [providerRuntimeSnapshot, setProviderRuntimeSnapshot] =
    createSignal<ProviderRuntimeSnapshot>(FALLBACK_PROVIDER_RUNTIMES);
  const updating = new Set<AgentProviderId>();
  let disposed = false;
  function providerUpdate(provider: AgentProviderId, snapshot = providerRuntimeSnapshot()): ProviderUpdate {
    const runtime = snapshot.providers[provider];
    return {
      provider,
      name: provider === "codex" ? "ChatGPT" : provider === "claude" ? "Claude" : "Grok",
      runtime,
      availableVersion: runtime.availableVersion ?? null,
    };
  }
  /** Revisioned, because the pushed event and the awaited call can land out of order. */
  function applyProviderRuntimeSnapshot(snapshot: ProviderRuntimeSnapshot): void {
    if (disposed) return;
    const current = providerRuntimeSnapshot();
    if (snapshot.revision < current.revision) return;
    for (const provider of ["codex", "claude", "grok"] as const) {
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

  async function downloadProviderRuntime(provider: AgentProviderId): Promise<void> {
    if (!api) throw new Error("Provider downloads are unavailable.");
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
      applyProviderRuntimeSnapshot(await api.download(provider));
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
    if (!api) throw new Error("Provider downloads are unavailable.");
    const snapshot = await api.cancel(provider);
    updating.delete(provider);
    dismissProviderUpdateToast(provider);
    applyProviderRuntimeSnapshot(snapshot);
    desktopAnalytics.scope().track("provider_action", {
      provider,
      action: "download_cancelled",
      result: "succeeded",
    });
  }

  onSettled(() => {
    const unsubscribe = api?.onEvent((snapshot) => flush(() => applyProviderRuntimeSnapshot(snapshot)));
    void api
      ?.getStatus()
      .then(applyProviderRuntimeSnapshot)
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe?.();
      updating.clear();
      for (const provider of ["codex", "claude", "grok"] as const) dismissProviderUpdateToast(provider);
    };
  });
  return {
    providerRuntimeStatuses: () => providerRuntimeSnapshot().providers,
    providerAvailableVersions: () => ({
      codex: providerUpdate("codex").availableVersion,
      claude: providerUpdate("claude").availableVersion,
      grok: providerUpdate("grok").availableVersion,
    }),
    providerRuntimeDownloadsAvailable: () => Boolean(api),
    applyProviderRuntimeSnapshot,
    downloadProviderRuntime,
    cancelProviderRuntimeDownload,
  };
}
