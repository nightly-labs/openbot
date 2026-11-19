import { createSignal } from "solid-js";

const SHOW_AGENT_STEPS_STORAGE_KEY = "openbot:show-agent-steps";

let unsavedPreference: boolean | undefined;

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
    unsavedPreference = show;
  }
}

const [showAgentSteps, setShowAgentStepsSignal] = createSignal(readShowAgentSteps());

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== SHOW_AGENT_STEPS_STORAGE_KEY) return;
  setShowAgentStepsSignal(readShowAgentSteps());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

export function useShowAgentSteps(): () => boolean {
  return showAgentSteps;
}

export function setShowAgentSteps(show: boolean): void {
  writeShowAgentSteps(show);
  setShowAgentStepsSignal(show);
}
