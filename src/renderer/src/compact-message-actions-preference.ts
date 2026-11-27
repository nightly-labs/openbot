import { createSignal } from "solid-js";

const COMPACT_MESSAGE_ACTIONS_STORAGE_KEY = "openbot:compact-message-actions";

let unsavedPreference: boolean | undefined;

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
    unsavedPreference = compact;
  }
}

const [compactMessageActions, setCompactMessageActionsSignal] = createSignal(readCompactMessageActions());

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== COMPACT_MESSAGE_ACTIONS_STORAGE_KEY) return;
  setCompactMessageActionsSignal(readCompactMessageActions());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

export function useCompactMessageActions(): () => boolean {
  return compactMessageActions;
}

export function setCompactMessageActions(compact: boolean): void {
  writeCompactMessageActions(compact);
  setCompactMessageActionsSignal(compact);
}
