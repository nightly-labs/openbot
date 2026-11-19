import type { ProviderAdminDesktopApi, ProviderRuntimeSnapshot, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import type { ProviderRuntimeSource } from "./provider-runtime-store";

const POLL_MS = 1000;
const RETRY_MS = 5000;

export function remoteProviderRuntimes(admin: () => ProviderAdminDesktopApi, serverId: string): ProviderRuntimeSource {
  const listeners = new Set<(snapshot: ProviderRuntimeSnapshot) => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let starting = 0;

  function poll(delay: number): void {
    if (timer !== undefined || listeners.size === 0) return;
    timer = setTimeout(() => {
      timer = undefined;
      admin()
        .getRuntimes(serverId)
        .then(
          (snapshot) => {
            for (const listener of listeners) listener(snapshot);
            if (running(snapshot) || starting > 0) poll(POLL_MS);
          },
          () => poll(RETRY_MS),
        );
    }, delay);
  }

  function observe(snapshot: ProviderRuntimeSnapshot): ProviderRuntimeSnapshot {
    if (running(snapshot)) poll(POLL_MS);
    return snapshot;
  }

  return {
    getStatus: () => admin().getRuntimes(serverId).then(observe),
    download: (provider) => {
      starting += 1;
      poll(POLL_MS);
      return admin()
        .downloadRuntime(provider, serverId)
        .finally(() => {
          starting -= 1;
        })
        .then(observe);
    },
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
