import type { AppAppearancePreference, ChatBackgroundColor } from "@openbot/contracts/app-appearance";

type Scheme = "light" | "dark";
type ChatBackgroundPreference = Pick<AppAppearancePreference, "chatBackgroundLight" | "chatBackgroundDark">;

const SCHEMES: readonly Scheme[] = ["light", "dark"];

/** The colors that the user picked, and whether an animated backdrop plays behind the window. */
let colors: ChatBackgroundPreference = { chatBackgroundLight: null, chatBackgroundDark: null };
let backdrop = false;

/** A backdrop paints the whole window, so it replaces the color that the user picked. */
function colorOf(scheme: Scheme): ChatBackgroundColor | null {
  if (backdrop) return null;
  return scheme === "light" ? colors.chatBackgroundLight : colors.chatBackgroundDark;
}

/**
 * Sets the chat background of each scheme on the root element, or removes it for null.
 * `styles/chat-background.css` shows the one of the scheme that the window shows, in conversations
 * only. The preload let only `#rrggbb` through, so each value is a color.
 */
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

/** The colors that the user picked in Settings. */
export function applyChatBackground(preference: ChatBackgroundPreference): void {
  colors = { chatBackgroundLight: preference.chatBackgroundLight, chatBackgroundDark: preference.chatBackgroundDark };
  render();
}

/** While an animated backdrop plays behind the window, the chat background color does not show. */
export function hideChatBackgroundForBackdrop(hidden: boolean): void {
  backdrop = hidden;
  render();
}
