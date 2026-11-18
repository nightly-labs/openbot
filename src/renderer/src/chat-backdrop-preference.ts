import { type ChatBackdropChoice, isChatBackdropChoice } from "@openbot/ui/features/conversation/chat-backdrop";
import { createSignal } from "solid-js";

const CHAT_BACKDROP_STORAGE_KEY = "openbot:chat-backdrop";

/** The choice for this page after the browser did not save it. It wins over an older saved value. */
let unsavedPreference: ChatBackdropChoice | null | undefined;

/**
 * The backdrop behind the window on this device and browser: a built-in scene, or `custom:<id>` of
 * a backdrop in `custom-backdrops.ts`. Null is none. It only changes this
 * screen, so it is not sent to a joined server. Reading `window.localStorage` throws when the browser
 * blocks storage, so it is read inside the guard.
 */
function readChatBackdrop(): ChatBackdropChoice | null {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    const value = window.localStorage.getItem(CHAT_BACKDROP_STORAGE_KEY);
    return isChatBackdropChoice(value) ? value : null;
  } catch {
    return null;
  }
}

function writeChatBackdrop(scene: ChatBackdropChoice | null): void {
  try {
    if (scene === null) window.localStorage.removeItem(CHAT_BACKDROP_STORAGE_KEY);
    else window.localStorage.setItem(CHAT_BACKDROP_STORAGE_KEY, scene);
    unsavedPreference = undefined;
  } catch {
    // Blocked or full storage keeps the choice for this page only.
    unsavedPreference = scene;
  }
}

const [chatBackdrop, setChatBackdropSignal] = createSignal(readChatBackdrop());

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== CHAT_BACKDROP_STORAGE_KEY) return;
  const scene = readChatBackdrop();
  setChatBackdropSignal(scene);
}

if (typeof window !== "undefined") {
  // One registration per page: addEventListener ignores the same listener twice, and HMR
  // disposal removes it when this module is replaced.
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

/** The shared reactive preference: a Settings change reaches the window at once. */
export function useChatBackdrop(): () => ChatBackdropChoice | null {
  return chatBackdrop;
}

export function setChatBackdrop(scene: ChatBackdropChoice | null): void {
  writeChatBackdrop(scene);
  setChatBackdropSignal(scene);
}
