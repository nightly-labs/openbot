import type { ShortcutKeyEvent } from "@openbot/ui/features/settings/keyboard-shortcuts";
import { matchesShortcut } from "./keyboard-shortcut-preference";

export function isGlobalSearchShortcut(event: ShortcutKeyEvent): boolean {
  return matchesShortcut(event, "globalSearch");
}
