import type {
  ProviderAdminDesktopApi,
  ProviderRuntimeSnapshot,
  ProviderRuntimeStatus,
  ProviderRuntimesDesktopApi,
} from "@openbot/contracts/ipc";

/** How often a download on the host is read again while it runs. */
const POLL_MS = 1000;
/** The wait after a read failed, so a host that went away is not asked every second. */
const RETRY_MS = 5000;

/**
 * The managed runtimes of a joined server's host, in the shape the runtime store takes for this
 * computer's. `providers-v1` sends no progress event, so while a download runs on the host this
 * reads the status again and hands it to the store's listener. The reads stop when no download runs
 * and when the store unsubscribes.
 */
export function remoteProviderRuntimes(
  admin: () => ProviderAdminDesktopApi,
  serverId: string,
): ProviderRuntimesDesktopApi {
  const listeners = new Set<(snapshot: ProviderRuntimeSnapshot) => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function poll(delay: number): void {
    if (timer !== undefined || listeners.size === 0) return;
    timer = setTimeout(() => {
      timer = undefined;
      admin()
        .getRuntimes(serverId)
        .then(
          (snapshot) => {
            for (const listener of listeners) listener(snapshot);
            if (running(snapshot)) poll(POLL_MS);
          },
          () => poll(RETRY_MS),
        );
    }, delay);
  }

  /** Starts the reads when the answer to a call shows a download under way. */
  function observe(snapshot: ProviderRuntimeSnapshot): ProviderRuntimeSnapshot {
    if (running(snapshot)) poll(POLL_MS);
    return snapshot;
  }

  return {
    getStatus: () => admin().getRuntimes(serverId).then(observe),
    download: (provider) => admin().downloadRuntime(provider, serverId).then(observe),
    cancel: (provider) => admin().cancelRuntime(provider, serverId).then(observe),
    checkForUpdates: () => admin().checkRuntimeUpdates(serverId).then(observe),
    onEvent: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0 || timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
      };
    },
  };
}

function running(snapshot: ProviderRuntimeSnapshot): boolean {
  const statuses: ProviderRuntimeStatus[] = [
    ...Object.values(snapshot.providers),
    ...Object.values(snapshot.toolRuntimes),
  ];
  return statuses.some((status) => status.phase === "downloading" || status.phase === "finishing");
}
