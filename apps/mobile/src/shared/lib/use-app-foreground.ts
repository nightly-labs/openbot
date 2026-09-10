import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

let foreground = AppState.currentState !== "background";
const listeners = new Set<() => void>();
let subscription: ReturnType<typeof AppState.addEventListener> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!subscription) {
    foreground = AppState.currentState !== "background";
    subscription = AppState.addEventListener("change", (state) => {
      // Notification Center and other system overlays do not end a foreground visit.
      if (state === "inactive") return;
      const next = state === "active";
      if (foreground === next) return;
      foreground = next;
      for (const notify of listeners) notify();
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      subscription?.remove();
      subscription = null;
    }
  };
}

function getSnapshot() {
  return subscription ? foreground : AppState.currentState !== "background";
}

/** Lifecycle only. Consumers own their network work and cancellation. */
export function useAppForeground() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
