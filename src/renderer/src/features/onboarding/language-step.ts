import { createSignal } from "solid-js";

const LANGUAGE_STEP_STORAGE_KEY = "openbot:language-step-done";

type StepStorage = Pick<Storage, "getItem" | "setItem">;

function read(storage: StepStorage | undefined): boolean {
  try {
    return (storage ?? window.localStorage).getItem(LANGUAGE_STEP_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function createLanguageStep(storage?: StepStorage) {
  const [done, setDone] = createSignal(read(storage));
  const [reopened, setReopened] = createSignal(false);
  return {
    done,
    reopened,
    reopen(): void {
      setReopened(true);
      setDone(false);
    },
    complete(): void {
      setReopened(false);
      setDone(true);
      try {
        (storage ?? window.localStorage).setItem(LANGUAGE_STEP_STORAGE_KEY, "true");
      } catch {}
    },
  };
}
