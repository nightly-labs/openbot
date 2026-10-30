/** Where the keys of the full browser view work. The web client leaves them to the user's browser. */
export type BrowserShortcutPlatform = "mac" | "pc";

export type BrowserViewCommand =
  | { kind: "select"; offset: 1 | -1 }
  | { kind: "selectIndex"; index: number | "last" }
  | { kind: "move"; offset: 1 | -1 }
  | { kind: "newTab" }
  | { kind: "reopen" }
  | { kind: "close" }
  | { kind: "focusAddress" }
  | { kind: "reload" }
  | { kind: "back" }
  | { kind: "forward" };

interface ShortcutKey {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** The command of a key press in the full view, as other browsers have them, or undefined. */
export function browserViewCommand(
  event: ShortcutKey,
  platform: BrowserShortcutPlatform,
): BrowserViewCommand | undefined {
  const key = event.key.toLowerCase();
  const mod = platform === "mac" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (event.ctrlKey && !event.metaKey && !event.altKey && key === "tab") {
    return { kind: "select", offset: event.shiftKey ? -1 : 1 };
  }
  if (event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey && (key === "pageup" || key === "pagedown")) {
    return { kind: "move", offset: key === "pagedown" ? 1 : -1 };
  }
  if (!mod) return undefined;
  if (event.altKey) {
    if (event.shiftKey || platform !== "mac") return undefined;
    if (key === "arrowright") return { kind: "select", offset: 1 };
    if (key === "arrowleft") return { kind: "select", offset: -1 };
    return undefined;
  }
  if (key === "t") return event.shiftKey ? { kind: "reopen" } : { kind: "newTab" };
  if (event.shiftKey) return undefined;
  if (key === "w") return { kind: "close" };
  if (key === "l") return { kind: "focusAddress" };
  if (key === "r") return { kind: "reload" };
  if (key === "[") return { kind: "back" };
  if (key === "]") return { kind: "forward" };
  if (/^[1-9]$/.test(key)) return { kind: "selectIndex", index: key === "9" ? "last" : Number(key) - 1 };
  return undefined;
}

export type BrowserShortcutName = "newTab" | "reopen" | "close" | "reload" | "forward" | "moveLeft" | "moveRight";

const MAC_GLYPHS: Record<BrowserShortcutName, string> = {
  newTab: "⌘T",
  reopen: "⇧⌘T",
  close: "⌘W",
  reload: "⌘R",
  forward: "⌘]",
  moveLeft: "⌃⇧PgUp",
  moveRight: "⌃⇧PgDn",
};

const PC_GLYPHS: Record<BrowserShortcutName, string> = {
  newTab: "Ctrl+T",
  reopen: "Ctrl+Shift+T",
  close: "Ctrl+W",
  reload: "Ctrl+R",
  forward: "Ctrl+]",
  moveLeft: "Ctrl+Shift+PgUp",
  moveRight: "Ctrl+Shift+PgDn",
};

/** The keys of a command, as a menu shows them on this platform. */
export function browserShortcutGlyph(name: BrowserShortcutName, platform: BrowserShortcutPlatform): string {
  return (platform === "mac" ? MAC_GLYPHS : PC_GLYPHS)[name];
}

/** The `aria-keyshortcuts` value of a control. */
export function browserAriaShortcut(
  name: "newTab" | "back" | "forward" | "reload" | "address",
  platform: BrowserShortcutPlatform | undefined,
): string | undefined {
  if (!platform) return undefined;
  const mod = platform === "mac" ? "Meta" : "Control";
  const key = { newTab: "T", back: "BracketLeft", forward: "BracketRight", reload: "R", address: "L" }[name];
  return `${mod}+${key}`;
}
