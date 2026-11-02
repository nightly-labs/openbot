import { createSignal } from "solid-js";

const SHOW_AGENT_STEPS_STORAGE_KEY = "openbot:show-agent-steps";

/** The choice for this page after the browser did not save it. It wins over an older saved value. */
let unsavedPreference: boolean | undefined;

/**
 * Whether the steps of a turn are open at first, on this device and browser. They are closed unless
 * the user chose otherwise. Reading `window.localStorage` throws when the browser blocks storage, so
 * it is read inside the guard.
 */
export function readShowAgentSteps(): boolean {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    return window.localStorage.getItem(SHOW_AGENT_STEPS_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeShowAgentSteps(show: boolean): void {
  try {
    window.localStorage.setItem(SHOW_AGENT_STEPS_STORAGE_KEY, String(show));
    unsavedPreference = undefined;
  } catch {
    // Blocked or full storage keeps the choice for this page only.
    unsavedPreference = show;
  }
}

const [showAgentSteps, setShowAgentStepsSignal] = createSignal(readShowAgentSteps());

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== SHOW_AGENT_STEPS_STORAGE_KEY) return;
  setShowAgentStepsSignal(readShowAgentSteps());
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
export function useShowAgentSteps(): () => boolean {
  return showAgentSteps;
}

export function setShowAgentSteps(show: boolean): void {
  writeShowAgentSteps(show);
  setShowAgentStepsSignal(show);
}
