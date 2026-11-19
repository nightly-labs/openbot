import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";
import { isAndroid } from "./platform";

let reduced: boolean | null = null;
let started = false;
const listeners = new Set<() => void>();

function update(value: boolean): void {
  if (reduced === value) return;
  reduced = value;
  for (const notify of listeners) notify();
}

function subscribe(listener: () => void) {
  if (!started) {
    started = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then(update, () => update(false));
    AccessibilityInfo.addEventListener("reduceTransparencyChanged", update);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): boolean {
  return isAndroid ? false : (reduced ?? true);
}

export function useReducedTransparency(): boolean {
  return useSyncExternalStore(subscribe, snapshot);
}
