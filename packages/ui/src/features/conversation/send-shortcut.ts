/**
 * The DOM-free keyboard rule for the message send shortcut. Shared UI owns this rule; the
 * renderer owns persistence and the device adapter, and passes the resolved shortcut down
 * through typed props.
 */

/** How the user sends a message: plain Enter, or the platform modifier with Enter. */
export type SendShortcutMode = "enter" | "mod-enter";

/** The resolved chord the keyboard listens for. */
export type SendShortcut = "enter" | "meta-enter" | "ctrl-enter";

export const SEND_SHORTCUT_MODES: readonly SendShortcutMode[] = ["enter", "mod-enter"];

/** The stored value, or Enter when it is absent or invalid. */
export function parseSendShortcutMode(value: unknown): SendShortcutMode {
  return value === "mod-enter" ? "mod-enter" : "enter";
}

/** The device with the keyboard decides the modifier, never a remote host. */
export function resolveSendShortcut(
  mode: SendShortcutMode,
  devicePlatform: "darwin" | "win32" | "linux",
): SendShortcut {
  if (mode !== "mod-enter") return "enter";
  return devicePlatform === "darwin" ? "meta-enter" : "ctrl-enter";
}

interface SendShortcutKey {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * Whether the keydown is exactly the send chord. Shift or Alt with the chord must not send,
 * and any other modifier combination must not send either.
 */
export function isSendShortcutKey(event: SendShortcutKey, shortcut: SendShortcut): boolean {
  if (event.key !== "Enter" || event.shiftKey || event.altKey) return false;
  if (shortcut === "enter") return !event.metaKey && !event.ctrlKey;
  if (shortcut === "meta-enter") return event.metaKey && !event.ctrlKey;
  return event.ctrlKey && !event.metaKey;
}
