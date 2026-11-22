import {
  createContext,
  type PropsWithChildren,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { MobileWorkspaceActions, MobileWorkspaceContextValue } from "@/features/workspace/model/workspace-types";

const MobileWorkspaceContext = createContext<MobileWorkspaceContextValue | null>(null);
const MobileWorkspaceActionsContext = createContext<MobileWorkspaceActions | null>(null);

interface WorkspaceValueStore {
  get: () => MobileWorkspaceContextValue;
  subscribe: (listener: () => void) => () => void;
  publish: (value: MobileWorkspaceContextValue) => void;
}

const MobileWorkspaceStoreContext = createContext<WorkspaceValueStore | null>(null);

function createWorkspaceValueStore(initial: MobileWorkspaceContextValue): WorkspaceValueStore {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish: (value) => {
      if (value === current) return;
      current = value;
      for (const listener of listeners) listener();
    },
  };
}

export function WorkspaceContexts({
  value,
  actions,
  children,
}: PropsWithChildren<{ value: MobileWorkspaceContextValue; actions: MobileWorkspaceActions }>) {
  const [valueStore] = useState(() => createWorkspaceValueStore(value));
  useLayoutEffect(() => valueStore.publish(value), [valueStore, value]);
  return (
    <MobileWorkspaceContext.Provider value={value}>
      <MobileWorkspaceStoreContext.Provider value={valueStore}>
        <MobileWorkspaceActionsContext.Provider value={actions}>{children}</MobileWorkspaceActionsContext.Provider>
      </MobileWorkspaceStoreContext.Provider>
    </MobileWorkspaceContext.Provider>
  );
}

export function useMobileWorkspace(): MobileWorkspaceContextValue {
  const value = useContext(MobileWorkspaceContext);
  if (!value) throw new Error("useMobileWorkspace must be used within MobileWorkspaceProvider.");
  return value;
}

export function useMobileWorkspaceActions(): MobileWorkspaceActions {
  const actions = useContext(MobileWorkspaceActionsContext);
  if (!actions) throw new Error("useMobileWorkspaceActions must be used within MobileWorkspaceProvider.");
  return actions;
}

function useWorkspaceValueStore(): WorkspaceValueStore {
  const store = useContext(MobileWorkspaceStoreContext);
  if (!store) throw new Error("The workspace selector must be used within MobileWorkspaceProvider.");
  return store;
}

export function useMobileWorkspaceSelector<T>(
  select: (workspace: MobileWorkspaceContextValue) => T,
  isEqual?: (previous: T, next: T) => boolean,
): T {
  const store = useWorkspaceValueStore();
  const kept = useRef<{ value: T } | null>(null);
  return useSyncExternalStore(store.subscribe, () => {
    const next = select(store.get());
    if (!isEqual) return next;
    const previous = kept.current;
    if (previous && (Object.is(previous.value, next) || isEqual(previous.value, next))) return previous.value;
    kept.current = { value: next };
    return next;
  });
}

export function useMobileWorkspaceReader(): () => MobileWorkspaceContextValue {
  return useWorkspaceValueStore().get;
}
