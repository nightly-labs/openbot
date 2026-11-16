import { createSignal } from "solid-js";

const MESSAGES_ON_LEFT_STORAGE_KEY = "openbot:messages-on-left";

/** The choice for this page after the browser did not save it. It wins over an older saved value. */
let unsavedPreference: boolean | undefined;

/**
 * Whether the reader's own messages stand on the left with the agents' messages, as one column, on
 * this device and browser. They stand on the right unless the user chose otherwise. Reading
 * `window.localStorage` throws when the browser blocks storage, so it is read inside the guard.
 */
export function readMessagesOnLeft(): boolean {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    return window.localStorage.getItem(MESSAGES_ON_LEFT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeMessagesOnLeft(left: boolean): void {
  try {
    window.localStorage.setItem(MESSAGES_ON_LEFT_STORAGE_KEY, String(left));
    unsavedPreference = undefined;
  } catch {
    // Blocked or full storage keeps the choice for this page only.
    unsavedPreference = left;
  }
}

/** The chat styles read this attribute, so every chat of the page changes at once. */
function applyMessagesOnLeft(left: boolean): void {
  if (typeof document === "undefined") return;
  if (left) document.documentElement.dataset.openbotMessageAlign = "start";
  else delete document.documentElement.dataset.openbotMessageAlign;
}

const [messagesOnLeft, setMessagesOnLeftSignal] = createSignal(readMessagesOnLeft());

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== MESSAGES_ON_LEFT_STORAGE_KEY) return;
  const left = readMessagesOnLeft();
  setMessagesOnLeftSignal(left);
  applyMessagesOnLeft(left);
}

if (typeof window !== "undefined") {
  applyMessagesOnLeft(readMessagesOnLeft());
  // One registration per page: addEventListener ignores the same listener twice, and HMR
  // disposal removes it when this module is replaced.
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

/** The shared reactive preference: a Settings change reaches every open chat at once. */
export function useMessagesOnLeft(): () => boolean {
  return messagesOnLeft;
}

export function setMessagesOnLeft(left: boolean): void {
  writeMessagesOnLeft(left);
  setMessagesOnLeftSignal(left);
  applyMessagesOnLeft(left);
}
