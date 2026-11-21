import type { AppTextKey } from "@openbot/i18n";
import {
  parseShortcutOverrides,
  resolveShortcut,
  type ShortcutChord,
  type ShortcutCommand,
  type ShortcutEnvironment,
  type ShortcutKeyEvent,
  type ShortcutOverrides,
  serializeShortcutOverrides,
  shortcutMatches,
  shortcutText,
  withShortcut,
} from "@openbot/ui/features/settings/keyboard-shortcuts";
import { createSignal } from "solid-js";
import { currentDevicePlatform } from "./send-shortcut-preference";

const KEYBOARD_SHORTCUTS_STORAGE_KEY = "openbot:keyboard-shortcuts";

let unsavedOverrides: ShortcutOverrides | undefined;

function readOverrides(): ShortcutOverrides {
  if (unsavedOverrides !== undefined) return unsavedOverrides;
  try {
    return parseShortcutOverrides(window.localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY));
  } catch {
    return {};
  }
}

function writeOverrides(overrides: ShortcutOverrides): void {
  try {
    if (Object.keys(overrides).length === 0) window.localStorage.removeItem(KEYBOARD_SHORTCUTS_STORAGE_KEY);
    else window.localStorage.setItem(KEYBOARD_SHORTCUTS_STORAGE_KEY, serializeShortcutOverrides(overrides));
    unsavedOverrides = undefined;
  } catch {
    unsavedOverrides = overrides;
  }
}

const [overrides, setOverridesSignal] = createSignal<ShortcutOverrides>(
  typeof window === "undefined" ? {} : readOverrides(),
);

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== KEYBOARD_SHORTCUTS_STORAGE_KEY) return;
  setOverridesSignal(readOverrides());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

export function shortcutEnvironment(): ShortcutEnvironment {
  return { platform: currentDevicePlatform(), browser: typeof window === "undefined" || !("openbot" in window) };
}

export function useShortcutOverrides(): () => ShortcutOverrides {
  return overrides;
}

export function setShortcut(command: ShortcutCommand, key: ShortcutChord | null): void {
  const next = withShortcut(overrides(), command, key);
  writeOverrides(next);
  setOverridesSignal(next);
}

export function resetShortcuts(): void {
  writeOverrides({});
  setOverridesSignal({});
}

export function currentShortcut(command: ShortcutCommand): ShortcutChord {
  return resolveShortcut(command, overrides(), shortcutEnvironment());
}

export function matchesShortcut(event: ShortcutKeyEvent, command: ShortcutCommand): boolean {
  return shortcutMatches(event, currentShortcut(command));
}

export function shortcutLabel(command: ShortcutCommand, translate: (key: AppTextKey) => string): string {
  return shortcutText(currentShortcut(command), shortcutEnvironment().platform, translate);
}
