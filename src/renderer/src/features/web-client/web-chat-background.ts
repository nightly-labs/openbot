import { type ChatBackgroundColor, isChatBackgroundColor } from "@openbot/contracts/app-appearance";
import { createSignal } from "solid-js";
import { applyChatBackground } from "../../chat-background";

const STORAGE_KEY = "openbot.web.chat-background";

export interface WebChatBackground {
  chatBackgroundLight: ChatBackgroundColor | null;
  chatBackgroundDark: ChatBackgroundColor | null;
}

const NONE: WebChatBackground = { chatBackgroundLight: null, chatBackgroundDark: null };

let unsavedPreference: WebChatBackground | undefined;

function read(): WebChatBackground {
  if (unsavedPreference !== undefined) return unsavedPreference;
  let value: unknown = null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    value = stored === null ? null : JSON.parse(stored);
    if (typeof value !== "object" || value === null) return NONE;
    const fields = new Map<string, unknown>(Object.entries(value));
    const light = fields.get("light");
    const dark = fields.get("dark");
    return {
      chatBackgroundLight: isChatBackgroundColor(light) ? light : null,
      chatBackgroundDark: isChatBackgroundColor(dark) ? dark : null,
    };
  } catch {
    return NONE;
  }
}

function write(value: WebChatBackground): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ light: value.chatBackgroundLight, dark: value.chatBackgroundDark }),
    );
    unsavedPreference = undefined;
  } catch {
    unsavedPreference = value;
  }
}

const [chatBackground, setChatBackgroundSignal] = createSignal<WebChatBackground>(NONE);

export function syncWebChatBackground(): () => void {
  setChatBackgroundSignal(read());
  applyChatBackground(chatBackground());
  function listen(event: StorageEvent): void {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    setChatBackgroundSignal(read());
    applyChatBackground(chatBackground());
  }
  window.addEventListener("storage", listen);
  return () => {
    window.removeEventListener("storage", listen);
    applyChatBackground(NONE);
  };
}

export function useWebChatBackground(): () => WebChatBackground {
  return chatBackground;
}

export function setWebChatBackground(scheme: "light" | "dark", color: ChatBackgroundColor | null): void {
  const next: WebChatBackground =
    scheme === "light"
      ? { ...chatBackground(), chatBackgroundLight: color }
      : { ...chatBackground(), chatBackgroundDark: color };
  write(next);
  setChatBackgroundSignal(next);
  applyChatBackground(next);
}
