import type { AppAppearancePreference, ChatBackgroundColor } from "@openbot/contracts/app-appearance";

type Scheme = "light" | "dark";

const SCHEMES: readonly Scheme[] = ["light", "dark"];

function colorOf(
  preference: Pick<AppAppearancePreference, "chatBackgroundLight" | "chatBackgroundDark">,
  scheme: Scheme,
) {
  return scheme === "light" ? preference.chatBackgroundLight : preference.chatBackgroundDark;
}

/**
 * Sets the chat background of each scheme on the root element, or removes it for null.
 * `styles/chat-background.css` shows the one of the scheme that the window shows, in conversations
 * only. The preload let only `#rrggbb` through, so each value is a color.
 */
export function applyChatBackground(
  preference: Pick<AppAppearancePreference, "chatBackgroundLight" | "chatBackgroundDark">,
): void {
  const root = document.documentElement;
  for (const scheme of SCHEMES) {
    const color: ChatBackgroundColor | null = colorOf(preference, scheme);
    const property = `--openbot-chat-background-${scheme}`;
    if (color === null) root.style.removeProperty(property);
    else root.style.setProperty(property, color);
    root.toggleAttribute(`data-openbot-chat-background-${scheme}`, color !== null);
  }
}
