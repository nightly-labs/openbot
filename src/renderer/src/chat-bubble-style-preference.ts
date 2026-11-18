import {
  type ChatBubbleStyle,
  DEFAULT_CHAT_BUBBLE_STYLE,
  isChatBubbleStyle,
} from "@openbot/ui/features/conversation/own-bubble";
import { createSignal } from "solid-js";

const CHAT_BUBBLE_STYLE_STORAGE_KEY = "openbot:chat-bubble-style";

/** The choice for this page after the browser did not save it. It wins over an older saved value. */
let unsavedPreference: ChatBubbleStyle | undefined;

/**
 * How the reader's own bubbles look in an agent chat, on this device and browser: Solid unless the
 * user chose otherwise. It only changes this screen, so other people on a server keep seeing the
 * reader's chat color. Reading `window.localStorage` throws when the browser blocks storage, so it is
 * read inside the guard.
 */
function readChatBubbleStyle(): ChatBubbleStyle {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    const value = window.localStorage.getItem(CHAT_BUBBLE_STYLE_STORAGE_KEY);
    return isChatBubbleStyle(value) ? value : DEFAULT_CHAT_BUBBLE_STYLE;
  } catch {
    return DEFAULT_CHAT_BUBBLE_STYLE;
  }
}

function writeChatBubbleStyle(style: ChatBubbleStyle): void {
  try {
    window.localStorage.setItem(CHAT_BUBBLE_STYLE_STORAGE_KEY, style);
    unsavedPreference = undefined;
  } catch {
    // Blocked or full storage keeps the choice for this page only.
    unsavedPreference = style;
  }
}

const [chatBubbleStyle, setChatBubbleStyleSignal] = createSignal(readChatBubbleStyle());

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== CHAT_BUBBLE_STYLE_STORAGE_KEY) return;
  setChatBubbleStyleSignal(readChatBubbleStyle());
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
export function useChatBubbleStyle(): () => ChatBubbleStyle {
  return chatBubbleStyle;
}

export function setChatBubbleStyle(style: ChatBubbleStyle): void {
  writeChatBubbleStyle(style);
  setChatBubbleStyleSignal(style);
}
