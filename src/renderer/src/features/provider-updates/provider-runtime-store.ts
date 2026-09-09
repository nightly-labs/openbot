import type { AgentProviderId, ProviderRuntimeSnapshot, ProviderRuntimesDesktopApi } from "@openbot/contracts/ipc";
import { createEffect, createSignal, flush, onSettled } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { FALLBACK_PROVIDER_RUNTIMES } from "../../app-defaults";
import { type ProviderUpdate, providerUpdatesToAnnounce } from "./provider-update";
import {
  dismissProviderUpdateToast,
  hideProviderUpdateToast,
  providerUpdateOfferClosed,
  reportProviderUpdateToast,
  showProviderUpdateToast,
} from "./provider-update-toast";

const PROVIDERS = ["codex", "claude", "grok"] as const;

/**
 * The provider CLIs OpenBot does not own: the ones the user installed themselves.
 *
 * They take the same update offer as a managed runtime - main compares both against the pinned
 * version - and only the work behind the offer differs, so this store routes it and the rest of the
 * app sees one update flow. Left out, everything here keeps working for managed runtimes alone.
 */
export interface ProviderCliOwners {
  /** The version of the CLI the user installed for this provider, or `null` for a managed one. */
  systemCliVersion?: (provider: AgentProviderId) => string | null;
  /** Runs that CLI's own updater. OpenBot downloads nothing on this path. */
  updateSystemCli?: (provider: AgentProviderId) => Promise<void>;
  /**
   * Whether the workspace on screen is this computer. Left out, it is.
   *
   * Every runtime this store reaches is local - `window.openbot.providerRuntimes` addresses no other
   * computer - while the agent status beside it describes whichever server is open. A remote
   * workspace therefore has no offer to make here, and an Update button it raised would change a
   * runtime the user is not looking at.
   */
  isLocalServer?: () => boolean;
}

/** The real download flow, shared by Settings and the other local provider controls. */
export function createProviderRuntimeStore(
  api: ProviderRuntimesDesktopApi | undefined,
  owners: ProviderCliOwners = {},
) {
  const [providerRuntimeSnapshot, setProviderRuntimeSnapshot] =
    createSignal<ProviderRuntimeSnapshot>(FALLBACK_PROVIDER_RUNTIMES);
  const updating = new Set<AgentProviderId>();
  /**
   * A version the user's own CLI updater will not install, per provider, with the version it stayed
   * on. Both are needed: a CLI that moves later is a different install, and the offer is live again.
   *
   * The updater can report success and leave the CLI exactly where it was: its release channel
   * decides what "latest" means for it, and that answer can be older than the version OpenBot pins.
   * Offering it again would walk the user through an update that cannot happen. Main keeps the
   * lasting record - it survives a restart, and it owns every version comparison - so this is only
   * the immediate echo, which settles the notification without waiting for the next snapshot.
   */
  const [refusedVersions, setRefusedVersions] = createSignal<
    Partial<Record<AgentProviderId, { installed: string; offered: string }>>
  >({});
  /** What the user was last told about, so one offer is not announced twice. */
  let announced: ProviderUpdate[] = [];
  let disposed = false;
  const isLocalServer = owners.isLocalServer ?? (() => true);
  function providerUpdate(provider: AgentProviderId, snapshot = providerRuntimeSnapshot()): ProviderUpdate {
    const runtime = snapshot.providers[provider];
    const systemVersion = owners.systemCliVersion?.(provider) ?? null;
    const availableVersion = runtime.availableVersion ?? null;
    const refused = refusedVersions()[provider];
    return {
      provider,
      name: provider === "codex" ? "ChatGPT" : provider === "claude" ? "Claude" : "Grok",
      // A CLI the user installed is the one the provider runs, whatever the managed runtime holds.
      // It is installed, on the version it reports.
      runtime: systemVersion ? { ...runtime, phase: "ready", version: systemVersion } : runtime,
      availableVersion:
        refused?.offered === availableVersion && refused.installed === systemVersion ? null : availableVersion,
    };
  }

  /**
   * The one thing an Update button does, wherever it is: the provider row, the notification, and the
   * Retry the notification offers after a failure. Who does the work depends on who owns the CLI.
   */
  function startProviderUpdate(provider: AgentProviderId): Promise<void> {
    if (!isLocalServer()) return Promise.reject(new Error("Provider CLI updates run on the computer that hosts them."));
    return owners.systemCliVersion?.(provider) ? updateSystemCli(provider) : downloadProviderRuntime(provider);
  }

  /**
   * Hands the update to the CLI's own updater and reports it in the same notification a managed
   * download uses. There is no progress to report - the CLI does not tell us any - so the
   * notification stays on the indeterminate step until the provider comes back on the new binary.
   */
  async function updateSystemCli(provider: AgentProviderId): Promise<void> {
    const run = owners.updateSystemCli;
    if (!run) throw new Error("Provider CLI updates are unavailable.");
    const update = providerUpdate(provider);
    showProviderUpdateToast(
      { ...update, runtime: { ...update.runtime, phase: "finishing", progress: null } },
      () => void startProviderUpdate(provider),
    );
    try {
      await run(provider);
    } catch (error) {
      if (disposed) return;
      const message = error instanceof Error ? error.message : "The update could not start. Try again.";
      reportProviderUpdateToast(
        { ...update, runtime: { ...update.runtime, phase: "download-error", message } },
        () => void startProviderUpdate(provider),
      );
      return;
    }
    if (disposed) return;
    // The provider reports its new version through the agent status, which has been applied by now.
    // An updater that finished on the version it started on has given its answer: the version
    // OpenBot pins is not one it will install, and repeating the offer would only repeat this.
    const offered = update.availableVersion;
    const installed = owners.systemCliVersion?.(provider) ?? null;
    const refused = offered !== null && installed !== null && installed === update.runtime.version;
    if (refused && installed) setRefusedVersions((current) => ({ ...current, [provider]: { installed, offered } }));
    const settled = providerUpdate(provider);
    // Read locally rather than through the signal just written: the write lands on the next flush.
    reportProviderUpdateToast(
      refused ? { ...settled, availableVersion: null } : settled,
      () => void startProviderUpdate(provider),
    );
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
      // Hidden, not dismissed: the offer outlives the workspace this store was built for.
      for (const provider of ["codex", "claude", "grok"] as const) hideProviderUpdateToast(provider);
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
    startProviderUpdate,
    downloadProviderRuntime,
    cancelProviderRuntimeDownload,
  };
}
