import { createSignal } from "solid-js";

const COMPACT_MESSAGE_ACTIONS_STORAGE_KEY = "openbot:compact-message-actions";

/** The choice for this page after the browser did not save it. It wins over an older saved value. */
let unsavedPreference: boolean | undefined;

/**
 * Whether a message shows only React, Reply and More beside it, with the time between messages, on
 * this device and browser. It does unless the user chose otherwise. Reading `window.localStorage` throws
 * when the browser blocks storage, so it is read inside the guard.
 */
export function readCompactMessageActions(): boolean {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    return window.localStorage.getItem(COMPACT_MESSAGE_ACTIONS_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeCompactMessageActions(compact: boolean): void {
  try {
    window.localStorage.setItem(COMPACT_MESSAGE_ACTIONS_STORAGE_KEY, String(compact));
    unsavedPreference = undefined;
  } catch {
    // Blocked or full storage keeps the choice for this page only.
    unsavedPreference = compact;
  }
}

const [compactMessageActions, setCompactMessageActionsSignal] = createSignal(readCompactMessageActions());

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== COMPACT_MESSAGE_ACTIONS_STORAGE_KEY) return;
  setCompactMessageActionsSignal(readCompactMessageActions());
}

if (typeof window !== "undefined") {
  // One registration per page: addEventListener ignores the same listener twice, and HMR
  // disposal removes it when this module is replaced.
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

/** The shared reactive preference: a Settings change reaches every open chat at once. */
export function useCompactMessageActions(): () => boolean {
  return compactMessageActions;
}

export function setCompactMessageActions(compact: boolean): void {
  writeCompactMessageActions(compact);
  setCompactMessageActionsSignal(compact);
}
