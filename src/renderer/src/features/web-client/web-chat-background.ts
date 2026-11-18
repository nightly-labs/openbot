import { type ChatBackgroundColor, isChatBackgroundColor } from "@openbot/contracts/app-appearance";
import { createSignal } from "solid-js";
import { applyChatBackground } from "../../chat-background";

/** The key under which this browser keeps the chat background of the web client. */
const STORAGE_KEY = "openbot.web.chat-background";

export interface WebChatBackground {
  chatBackgroundLight: ChatBackgroundColor | null;
  chatBackgroundDark: ChatBackgroundColor | null;
}

const NONE: WebChatBackground = { chatBackgroundLight: null, chatBackgroundDark: null };

/** The choice for this page after the browser did not save it. It wins over an older saved value. */
let unsavedPreference: WebChatBackground | undefined;

/**
 * Reading `window.localStorage` throws when the browser blocks storage, so it is read inside the
 * guard. Each color is checked on its own: another tab or an older value cannot put a CSS value that
 * is not a color on the root.
 */
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
    // Blocked or full storage keeps the choice for this page only.
    unsavedPreference = value;
  }
}

const [chatBackground, setChatBackgroundSignal] = createSignal<WebChatBackground>(NONE);

/**
 * The chat background of the web client, for Light and for Dark. The web client has no main process,
 * so this browser keeps it, as it keeps the theme. Returns the function that stops it and removes the
 * colors, so the public pages do not keep them after the user leaves `/app`.
 */
export function syncWebChatBackground(): () => void {
  setChatBackgroundSignal(read());
  applyChatBackground(chatBackground());
  function listen(event: StorageEvent): void {
    // `localStorage.clear()` in another tab sends no key.
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

/** The shared reactive preference: a Settings change reaches every open chat at once. */
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
