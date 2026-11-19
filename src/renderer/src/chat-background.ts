import type { AppAppearancePreference, ChatBackgroundColor } from "@openbot/contracts/app-appearance";

type Scheme = "light" | "dark";
type ChatBackgroundPreference = Pick<AppAppearancePreference, "chatBackgroundLight" | "chatBackgroundDark">;

const SCHEMES: readonly Scheme[] = ["light", "dark"];

let colors: ChatBackgroundPreference = { chatBackgroundLight: null, chatBackgroundDark: null };
let backdrop = false;

function colorOf(scheme: Scheme): ChatBackgroundColor | null {
  if (backdrop) return null;
  return scheme === "light" ? colors.chatBackgroundLight : colors.chatBackgroundDark;
}

function render(): void {
  const root = document.documentElement;
  for (const scheme of SCHEMES) {
    const color = colorOf(scheme);
    const property = `--openbot-chat-background-${scheme}`;
    if (color === null) root.style.removeProperty(property);
    else root.style.setProperty(property, color);
    root.toggleAttribute(`data-openbot-chat-background-${scheme}`, color !== null);
  }
}

export function applyChatBackground(preference: ChatBackgroundPreference): void {
  colors = { chatBackgroundLight: preference.chatBackgroundLight, chatBackgroundDark: preference.chatBackgroundDark };
  render();
}

export function hideChatBackgroundForBackdrop(hidden: boolean): void {
  backdrop = hidden;
  render();
}
