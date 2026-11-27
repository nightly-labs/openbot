import type { HostRemoteChatContent, RemoteChatContentChange } from "@openbot/contracts/ipc";
import { createContext, createSignal, type ParentProps, useContext } from "solid-js";

export interface RemoteChatContentCalls {
  getRemoteChatContent(serverId: string): Promise<HostRemoteChatContent>;
  setRemoteChatContent(enabled: boolean, serverId: string): Promise<HostRemoteChatContent>;
  onRemoteChatContent(listener: (change: RemoteChatContentChange) => void): () => void;
}

export interface RemoteChatContent {
  enabled(serverId: string | null | undefined): boolean;
  load(serverId: string): Promise<boolean>;
  set(enabled: boolean, serverId: string): Promise<boolean>;
}

const RETRY_AFTER_FAILURE_MS = 15_000;

const BLOCKED: RemoteChatContent = {
  enabled: () => false,
  load: async () => false,
  set: async () => false,
};

const RemoteChatContentContext = createContext<RemoteChatContent>(BLOCKED);

export function useRemoteChatContent(): RemoteChatContent {
  return useContext(RemoteChatContentContext);
}

export function createRemoteChatContent(calls: RemoteChatContentCalls): RemoteChatContent & { dispose(): void } {
  const [values, setValues] = createSignal<ReadonlyMap<string, boolean>>(new Map());
  const pending = new Map<string, Promise<boolean>>();
  const failedAt = new Map<string, number>();
  const [retryTick, setRetryTick] = createSignal(0);
  const remember = (serverId: string, enabled: boolean) => {
    setValues((current) => {
      if (current.get(serverId) === enabled) return current;
      const next = new Map(current);
      next.set(serverId, enabled);
      return next;
    });
    return enabled;
  };
  const load = (serverId: string): Promise<boolean> => {
    const running = pending.get(serverId);
    if (running) return running;
    const request = calls
      .getRemoteChatContent(serverId)
      .then(
        ({ enabled }) => {
          failedAt.delete(serverId);
          return remember(serverId, enabled);
        },
        () => {
          failedAt.set(serverId, Date.now());
          setTimeout(() => setRetryTick((tick) => tick + 1), RETRY_AFTER_FAILURE_MS);
          return false;
        },
      )
      .finally(() => pending.delete(serverId));
    pending.set(serverId, request);
    return request;
  };
  const dispose = calls.onRemoteChatContent(({ serverId, enabled }) => {
    failedAt.delete(serverId);
    remember(serverId, enabled);
  });
  return {
    enabled: (serverId) => {
      if (!serverId) return false;
      retryTick();
      const known = values().get(serverId);
      const failed = failedAt.get(serverId);
      const retry = failed === undefined || Date.now() - failed >= RETRY_AFTER_FAILURE_MS;
      if (known === undefined && !pending.has(serverId) && retry) queueMicrotask(() => void load(serverId));
      return known === true;
    },
    load,
    set: async (enabled, serverId) => remember(serverId, (await calls.setRemoteChatContent(enabled, serverId)).enabled),
    dispose,
  };
}

export function RemoteChatContentProvider(props: ParentProps<{ value: RemoteChatContent }>) {
  return <RemoteChatContentContext value={props.value}>{props.children}</RemoteChatContentContext>;
}
