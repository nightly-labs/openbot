import { type ChatBackdropChoice, isChatBackdropChoice } from "@openbot/ui/features/conversation/chat-backdrop";
import { createSignal } from "solid-js";

const CHAT_BACKDROP_STORAGE_KEY = "openbot:chat-backdrop";

let unsavedPreference: ChatBackdropChoice | null | undefined;

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
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

export function useChatBackdrop(): () => ChatBackdropChoice | null {
  return chatBackdrop;
}

export function setChatBackdrop(scene: ChatBackdropChoice | null): void {
  writeChatBackdrop(scene);
  setChatBackdropSignal(scene);
}
