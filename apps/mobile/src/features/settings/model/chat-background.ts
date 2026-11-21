import { type ChatBackgroundScheme, readableChatBackground } from "@openbot/brand/chat-colors";
import { type AvatarColor, isAvatarColor } from "@openbot/contracts/ipc";
import * as SecureStore from "expo-secure-store";
import { useUniwind } from "uniwind";
import { create } from "zustand";
import { storedFields } from "./stored-fields";

export type ChatBackgroundValue = Record<ChatBackgroundScheme, AvatarColor | null>;

const key = "openbot.mobile.chat-background.v1";

export const useChatBackground = create<ChatBackgroundValue & { ready: boolean }>(() => ({
  light: null,
  dark: null,
  ready: false,
}));

function parseStored(stored: string | null): ChatBackgroundValue | null {
  const fields = storedFields(stored);
  if (!fields) return null;
  const light = fields.get("light");
  const dark = fields.get("dark");
  return { light: isAvatarColor(light) ? light : null, dark: isAvatarColor(dark) ? dark : null };
}

export async function loadChatBackground(): Promise<void> {
  if (useChatBackground.getState().ready) return;
  try {
    const value = parseStored(await SecureStore.getItemAsync(key));
    if (value && !useChatBackground.getState().ready) useChatBackground.setState(value);
  } finally {
    useChatBackground.setState({ ready: true });
  }
}

export async function saveChatBackground(scheme: ChatBackgroundScheme, color: AvatarColor | null): Promise<void> {
  if (!useChatBackground.getState().ready) return;
  useChatBackground.setState({ [scheme]: color });
  const { light, dark } = useChatBackground.getState();
  await SecureStore.setItemAsync(key, JSON.stringify({ light, dark }));
}

export function useChatBackgroundColor(): AvatarColor | null {
  const scheme: ChatBackgroundScheme = useUniwind().theme === "dark" ? "dark" : "light";
  const color = useChatBackground((state) => state[scheme]);
  return color === null ? null : readableChatBackground(color, scheme);
}
