import {
  type ChatBubbleStyle,
  DEFAULT_CHAT_BUBBLE_STYLE,
  isChatBubbleStyle,
} from "@openbot/ui/features/conversation/own-bubble";
import { createSignal } from "solid-js";

const CHAT_BUBBLE_STYLE_STORAGE_KEY = "openbot:chat-bubble-style";

let unsavedPreference: ChatBubbleStyle | undefined;

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
    unsavedPreference = style;
  }
}

const [chatBubbleStyle, setChatBubbleStyleSignal] = createSignal(readChatBubbleStyle());

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== CHAT_BUBBLE_STYLE_STORAGE_KEY) return;
  setChatBubbleStyleSignal(readChatBubbleStyle());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

export function useChatBubbleStyle(): () => ChatBubbleStyle {
  return chatBubbleStyle;
}

export function setChatBubbleStyle(style: ChatBubbleStyle): void {
  writeChatBubbleStyle(style);
  setChatBubbleStyleSignal(style);
}
