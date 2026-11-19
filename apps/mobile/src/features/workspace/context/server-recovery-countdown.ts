import type { RemoteRecoveryStatus } from "@openbot/team-client";
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import type { MobileServer } from "../model/workspace-types";

interface RecoveryCountdown {
  status: RemoteRecoveryStatus;
  message: string | null;
}

export type RecoveryCountdowns = ReturnType<typeof createRecoveryCountdowns>;

const KEPT_STATUSES = 2;

function recoveryKey(status: RemoteRecoveryStatus): string {
  return `${status.phase}:${status.attempt}`;
}

export function createRecoveryCountdowns() {
  const latest = new Map<string, Map<string, RecoveryCountdown>>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    get(hostId: string, status: RemoteRecoveryStatus): RecoveryCountdown | undefined {
      return latest.get(hostId)?.get(recoveryKey(status));
    },
    publish(hostId: string, countdown: RecoveryCountdown): void {
      const statuses = latest.get(hostId) ?? new Map<string, RecoveryCountdown>();
      latest.set(hostId, statuses);
      const key = recoveryKey(countdown.status);
      statuses.delete(key);
      statuses.set(key, countdown);
      const oldest = statuses.keys().next().value;
      if (statuses.size > KEPT_STATUSES && oldest !== undefined) statuses.delete(oldest);
      for (const listener of listeners.get(hostId) ?? []) listener();
    },
    subscribe(hostId: string, listener: () => void): () => void {
      const current = listeners.get(hostId) ?? new Set<() => void>();
      listeners.set(hostId, current);
      current.add(listener);
      return () => {
        current.delete(listener);
        if (current.size === 0) listeners.delete(hostId);
      };
    },
  };
}

export const RecoveryCountdownContext = createContext<RecoveryCountdowns | null>(null);

const unsubscribed = () => undefined;

export function useLiveServerRecovery<T extends MobileServer | undefined>(server: T): T {
  const countdowns = useContext(RecoveryCountdownContext);
  const hostId = server?.id;
  const status = server?.recoveryStatus;
  const subscribe = useCallback(
    (listener: () => void) => (countdowns && hostId ? countdowns.subscribe(hostId, listener) : unsubscribed),
    [countdowns, hostId],
  );
  const countdown = useSyncExternalStore(subscribe, () =>
    countdowns && hostId && status ? countdowns.get(hostId, status) : undefined,
  );
  return useMemo(
    () =>
      server && countdown && countdown.status !== status
        ? { ...server, recoveryStatus: countdown.status, connectionMessage: countdown.message }
        : server,
    [countdown, server, status],
  );
}
