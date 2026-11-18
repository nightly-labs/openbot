import { type ChatBackgroundScheme, readableChatBackground } from "@openbot/brand/chat-colors";
import { type AvatarColor, isAvatarColor } from "@openbot/contracts/ipc";
import * as SecureStore from "expo-secure-store";
import { useUniwind } from "uniwind";
import { create } from "zustand";

/**
 * The background color of chats for each theme, or null for the background of the theme. Light and
 * Dark keep their own color, as on the desktop. The color stays on this phone.
 */
export type ChatBackgroundValue = Record<ChatBackgroundScheme, AvatarColor | null>;

const key = "openbot.mobile.chat-background.v1";

export const useChatBackground = create<ChatBackgroundValue & { ready: boolean }>(() => ({
  light: null,
  dark: null,
  ready: false,
}));

function parseStored(stored: string | null): ChatBackgroundValue | null {
  let value: unknown = null;
  try {
    value = stored === null ? null : JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const fields = new Map<string, unknown>(Object.entries(value));
  const light = fields.get("light");
  const dark = fields.get("dark");
  return { light: isAvatarColor(light) ? light : null, dark: isAvatarColor(dark) ? dark : null };
}

export async function loadChatBackground(): Promise<void> {
  if (useChatBackground.getState().ready) return;
  try {
    const value = parseStored(await SecureStore.getItemAsync(key));
    // A second startup read must not overwrite a change made in Settings.
    if (value && !useChatBackground.getState().ready) useChatBackground.setState(value);
  } finally {
    useChatBackground.setState({ ready: true });
  }
}

export async function saveChatBackground(scheme: ChatBackgroundScheme, color: AvatarColor | null): Promise<void> {
  if (!useChatBackground.getState().ready) return;
  // Apply immediately, including when storage fails.
  useChatBackground.setState({ [scheme]: color });
  const { light, dark } = useChatBackground.getState();
  await SecureStore.setItemAsync(key, JSON.stringify({ light, dark }));
}

/**
 * The background that a chat shows in the theme of the app, made readable, or null for the theme's
 * own. It reads the theme as Settings › Appearance does, so the chat shows the color edited there.
 */
export function useChatBackgroundColor(): AvatarColor | null {
  const scheme: ChatBackgroundScheme = useUniwind().theme === "dark" ? "dark" : "light";
  const color = useChatBackground((state) => state[scheme]);
  return color === null ? null : readableChatBackground(color, scheme);
}
