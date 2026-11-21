/** The command of a key press for chat search, or undefined. */

export type ChatSearchCommand = "open" | "next" | "prev";

export type ChatSearchShortcutPlatform = "mac" | "pc";

interface ChatSearchKey {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * The chat search keys of a key press, or undefined when the press is not one.
 *
 * The primary modifier follows the platform, as the browser view keys do: Cmd on macOS, Ctrl
 * elsewhere, and never both at once.
 */
export function chatSearchCommand(
  event: ChatSearchKey,
  platform: ChatSearchShortcutPlatform,
  searchOpen: boolean,
): ChatSearchCommand | undefined {
  const primaryModifier = platform === "mac" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  const key = event.key.toLocaleLowerCase();
  if (primaryModifier && !event.altKey && !event.shiftKey && key === "f") return "open";
  if (!searchOpen || !primaryModifier || event.altKey || key !== "g") return undefined;
  return event.shiftKey ? "prev" : "next";
}
