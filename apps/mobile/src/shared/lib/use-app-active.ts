import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

function subscribeAppState(onChange: () => void): () => void {
  const subscription = AppState.addEventListener("change", onChange);
  return () => subscription.remove();
}

function isAppActive(): boolean {
  return AppState.currentState === "active";
}

export function useAppActive(): boolean {
  return useSyncExternalStore(subscribeAppState, isAppActive, isAppActive);
}
