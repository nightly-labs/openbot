import { isManagedRuntimeProvider, type ManagedProviderId } from "@openbot/contracts/agent-providers";
import type {
  AgentProviderId,
  OpenBotDesktopApi,
  ProviderRuntimeSnapshot,
  ProviderRuntimeStatus,
} from "@openbot/contracts/ipc";
import { clone, type Listener, type MockRuntime } from "./mock-support";

export interface MockProviderRuntimeOptions {
  providerRuntimeSnapshot?: ProviderRuntimeSnapshot;
  providerRuntimeFailure?: boolean;
}

/** The provider CLIs and tool runtimes the app downloads, with progress the preview makes up. */
export function createMockProviderRuntimes(options: MockProviderRuntimeOptions, { schedule }: MockRuntime) {
  const runtimeSnapshot: ProviderRuntimeSnapshot = clone(
    options.providerRuntimeSnapshot ?? {
      revision: 0,
      providers: {
        codex: { phase: "not-downloaded", progress: null, message: null, version: null, availableVersion: null },
        claude: { phase: "not-downloaded", progress: null, message: null, version: null, availableVersion: null },
        grok: { phase: "not-downloaded", progress: null, message: null, version: null, availableVersion: null },
        opencode: { phase: "not-downloaded", progress: null, message: null, version: null, availableVersion: null },
        antigravity: { phase: "not-downloaded", progress: null, message: null, version: null, availableVersion: null },
      },
      // No `availableVersion`: a tool runtime is downloaded once and replaced by a release, so the
      // preview never offers an update for one.
      toolRuntimes: { bun: { phase: "not-downloaded", progress: null, message: null, version: null } },
    },
  );
  let failRuntimeDownload = options.providerRuntimeFailure ?? false;
  const runtimeListeners = new Set<Listener<ProviderRuntimeSnapshot>>();
  const runtimeTransfers = new Map<AgentProviderId, symbol>();
  const setRuntimeStatus = (provider: ManagedProviderId, status: ProviderRuntimeStatus) => {
    runtimeSnapshot.providers[provider] = status;
    runtimeSnapshot.revision += 1;
    for (const listener of runtimeListeners) listener(clone(runtimeSnapshot));
  };

  const providerRuntimes: OpenBotDesktopApi["providerRuntimes"] = {
    getStatus: async () => clone(runtimeSnapshot),
    // The preview has no upstream to ask: every offer it makes is already in the snapshot.
    checkForUpdates: async () => clone(runtimeSnapshot),
    download: async (provider) => {
      if (!isManagedRuntimeProvider(provider)) throw new Error("OpenBot does not manage this provider's CLI.");
      const installed = runtimeSnapshot.providers[provider];
      if (runtimeTransfers.has(provider) || (installed.phase === "ready" && !installed.availableVersion))
        return clone(runtimeSnapshot);
      const transfer = Symbol(provider);
      runtimeTransfers.set(provider, transfer);
      setRuntimeStatus(provider, { ...installed, phase: "downloading", progress: 0, message: null });
      const advance = (progress: number) => {
        if (runtimeTransfers.get(provider) !== transfer) return;
        if (failRuntimeDownload && progress >= 50) {
          failRuntimeDownload = false;
          runtimeTransfers.delete(provider);
          setRuntimeStatus(provider, {
            ...installed,
            phase: "download-error",
            progress: null,
            message: "The update was interrupted.",
          });
          return;
        }
        if (progress < 100) {
          setRuntimeStatus(provider, { ...installed, phase: "downloading", progress, message: null });
          schedule(() => advance(progress + 25), 300);
          return;
        }
        setRuntimeStatus(provider, { ...installed, phase: "finishing", progress: null, message: null });
        schedule(() => {
          if (runtimeTransfers.get(provider) !== transfer) return;
          runtimeTransfers.delete(provider);
          setRuntimeStatus(provider, {
            phase: "ready",
            progress: 100,
            message: null,
            version: installed.availableVersion ?? installed.version ?? "preview",
            availableVersion: null,
          });
        }, 300);
      };
      schedule(() => advance(25), 300);
      return clone(runtimeSnapshot);
    },
    cancel: async (provider) => {
      if (!isManagedRuntimeProvider(provider)) throw new Error("OpenBot does not manage this provider's CLI.");
      const current = runtimeSnapshot.providers[provider];
      if (current.phase !== "downloading") return clone(runtimeSnapshot);
      runtimeTransfers.delete(provider);
      setRuntimeStatus(provider, { ...current, phase: "not-downloaded", progress: null, message: null });
      return clone(runtimeSnapshot);
    },
    onEvent: (listener) => {
      runtimeListeners.add(listener);
      return () => runtimeListeners.delete(listener);
    },
  };

  return {
    providerRuntimes,
    dispose: () => {
      runtimeListeners.clear();
      runtimeTransfers.clear();
    },
  };
}
