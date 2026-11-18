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

/**
 * The same value as the context, for components that read one part of it. A list row reads its
 * own agent's state, so a message for another agent does not render every row again.
 */
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

/** Gives the workspace to the app in each of its three forms: the whole value, its store, and its actions. */
export function WorkspaceContexts({
  value,
  actions,
  children,
}: PropsWithChildren<{ value: MobileWorkspaceContextValue; actions: MobileWorkspaceActions }>) {
  const [valueStore] = useState(() => createWorkspaceValueStore(value));
  // Before paint, so a row that reads the store does not show a frame older than the screen.
  useLayoutEffect(() => valueStore.publish(value), [valueStore, value]);
  return (
    <MobileWorkspaceContext.Provider value={value}>
      <MobileWorkspaceStoreContext.Provider value={valueStore}>
        <MobileWorkspaceActionsContext.Provider value={actions}>{children}</MobileWorkspaceActionsContext.Provider>
      </MobileWorkspaceStoreContext.Provider>
    </MobileWorkspaceContext.Provider>
  );
}

/**
 * The whole workspace. The component renders again on every change; prefer the selector in lists,
 * and `useMobileWorkspaceActions` for a component that only sends commands.
 */
export function useMobileWorkspace(): MobileWorkspaceContextValue {
  const value = useContext(MobileWorkspaceContext);
  if (!value) throw new Error("useMobileWorkspace must be used within MobileWorkspaceProvider.");
  return value;
}

/** The workspace commands. They do not change in the session, so the component does not render again for them. */
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

/**
 * One part of the workspace. The component renders again only when that part changes (`Object.is`),
 * so `select` returns a primitive or a value that the workspace holds, never a new object or array.
 * With `isEqual`, the component keeps the value that it has while `isEqual` says that the new one is
 * the same for it. For a command, use `useMobileWorkspaceActions` instead.
 */
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

/** Reads the latest workspace when an event occurs. The component does not render again for changes. */
export function useMobileWorkspaceReader(): () => MobileWorkspaceContextValue {
  return useWorkspaceValueStore().get;
}
