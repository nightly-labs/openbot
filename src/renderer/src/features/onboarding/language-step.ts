import { createSignal } from "solid-js";

const LANGUAGE_STEP_STORAGE_KEY = "openbot:language-step-done";

type StepStorage = Pick<Storage, "getItem" | "setItem">;

/** Reading `window.localStorage` throws when the browser blocks storage, so it is read inside the guard. */
function read(storage: StepStorage | undefined): boolean {
  try {
    return (storage ?? window.localStorage).getItem(LANGUAGE_STEP_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Whether this computer has passed the language wheel before sign-in. It shows once: a later
 * sign-out goes straight to the sign-in screen, and Settings keeps the language.
 */
export function createLanguageStep(storage?: StepStorage) {
  const [done, setDone] = createSignal(read(storage));
  return {
    done,
    complete(): void {
      setDone(true);
      try {
        (storage ?? window.localStorage).setItem(LANGUAGE_STEP_STORAGE_KEY, "true");
      } catch {
        // Blocked storage passes the step for this window only.
      }
    },
  };
}
