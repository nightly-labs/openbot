import { createContext, use, useSyncExternalStore } from "react";
import type { GestureResponderEvent, ListViewToken } from "react-native";

const NEAR_ROWS = 6;

export interface ChatRowActivation {
  subscribe: (listener: () => void) => () => void;
  isActive: (key: string) => boolean;
  setKeys: (keys: readonly string[]) => void;
  reset: () => void;
  showVisible: (info: { viewableItems: ListViewToken[] }) => void;
  onTouchStart: () => void;
  onTouchEnd: (event: GestureResponderEvent) => void;
}

export function createChatRowActivation(): ChatRowActivation {
  let known = false;
  let active = new Set<string>();
  let keys: readonly string[] = [];
  let first = -1;
  let last = -1;
  let touching = false;
  let pending: Set<string> | null = null;
  const listeners = new Set<() => void>();
  const apply = (next: Set<string>) => {
    if (known && next.size === active.size && [...next].every((key) => active.has(key))) return;
    known = true;
    active = next;
    for (const listener of [...listeners]) listener();
  };
  const update = () => {
    if (first < 0) return;
    const next = new Set(keys.slice(Math.max(0, first - NEAR_ROWS), last + NEAR_ROWS + 1));
    if (touching) pending = next;
    else apply(next);
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isActive: (key) => !known || active.has(key),
    reset() {
      first = -1;
      last = -1;
      pending = null;
      if (!known) return;
      known = false;
      for (const listener of [...listeners]) listener();
    },
    setKeys(next) {
      keys = next;
      update();
    },
    showVisible({ viewableItems }) {
      const indexes = viewableItems.flatMap((token) => (typeof token.index === "number" ? [token.index] : []));
      if (indexes.length === 0) return;
      first = Math.min(...indexes);
      last = Math.max(...indexes);
      update();
    },
    onTouchStart() {
      touching = true;
    },
    onTouchEnd(event) {
      if (event.nativeEvent.touches.length > 0) return;
      touching = false;
      const next = pending;
      pending = null;
      if (next) apply(next);
    },
  };
}

export const ChatRowActivationContext = createContext<ChatRowActivation | null>(null);

const subscribeNever = () => () => {};

export function useChatRowDormant(key: string | null): boolean {
  const activation = use(ChatRowActivationContext);
  return useSyncExternalStore(
    activation?.subscribe ?? subscribeNever,
    () => activation !== null && key !== null && !activation.isActive(key),
  );
}
