import type { AppTextKey } from "@openbot/i18n";
import {
  parseSendShortcutMode,
  resolveSendShortcut,
  type SendShortcut,
  type SendShortcutMode,
} from "@openbot/ui/features/conversation/send-shortcut";
import { createSignal } from "solid-js";

const SEND_SHORTCUT_STORAGE_KEY = "openbot:send-shortcut-mode";

export type { SendShortcutMode };

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

/** The choice for this page after the browser did not save it. It wins over an older saved value. */
let unsavedPreference: SendShortcutMode | undefined;

/**
 * The mode for this device and browser. Enter sends unless the user chose the modifier chord.
 * Reading `window.localStorage` throws when the browser blocks storage, so it is read inside
 * the guard.
 */
export function readSendShortcutMode(storage?: PreferenceStorage): SendShortcutMode {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    return parseSendShortcutMode((storage ?? window.localStorage).getItem(SEND_SHORTCUT_STORAGE_KEY));
  } catch {
    return "enter";
  }
}

export function writeSendShortcutMode(mode: SendShortcutMode, storage?: PreferenceStorage): void {
  try {
    (storage ?? window.localStorage).setItem(SEND_SHORTCUT_STORAGE_KEY, mode);
    unsavedPreference = undefined;
  } catch {
    // Blocked or full storage keeps the choice for this page only.
    unsavedPreference = mode;
  }
}

/** The device with the keyboard: macOS takes ⌘Enter, Windows and Linux take Ctrl+Enter. */
export function devicePlatform(
  userAgentDataPlatform?: string,
  fallbackPlatform?: string,
): "darwin" | "win32" | "linux" {
  const platform = (userAgentDataPlatform ?? fallbackPlatform ?? "").toLowerCase();
  if (platform.includes("mac")) return "darwin";
  if (platform.includes("win")) return "win32";
  return "linux";
}

/** The device platform of this page, from the browser the keyboard is attached to. */
export function currentDevicePlatform(): "darwin" | "win32" | "linux" {
  return devicePlatform(undefined, navigator.platform);
}

const [sendShortcutMode, setSendShortcutModeSignal] = createSignal<SendShortcutMode>(readSendShortcutMode());

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== SEND_SHORTCUT_STORAGE_KEY) return;
  setSendShortcutModeSignal(readSendShortcutMode());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", readStorageIntoSignal);
}

/**
 * The shared reactive preference. Every consumer on this page follows the same signal, so a
 * Settings change reaches the composers without remounting them or touching their drafts.
 */
export function useSendShortcutMode(): () => SendShortcutMode {
  return sendShortcutMode;
}

export function setSendShortcutMode(mode: SendShortcutMode): void {
  writeSendShortcutMode(mode);
  setSendShortcutModeSignal(mode);
}

/**
 * The resolved chord for this page. Desktop call sites pass the host platform, which is the
 * device with the keyboard there; web call sites leave it empty and the browser is detected.
 */
export function deviceSendShortcut(appPlatform?: "darwin" | "win32" | "linux"): SendShortcut {
  return resolveSendShortcut(sendShortcutMode(), appPlatform ?? currentDevicePlatform());
}

const SEND_HINT_KEYS = {
  enter: "composer.send.hint.enter",
  "meta-enter": "composer.send.hint.modEnterMac",
  "ctrl-enter": "composer.send.hint.modEnterWin",
} as const satisfies Record<SendShortcut, AppTextKey>;

const SAVE_HINT_KEYS = {
  enter: "composer.save.hint.enter",
  "meta-enter": "composer.save.hint.modEnterMac",
  "ctrl-enter": "composer.save.hint.modEnterWin",
} as const satisfies Record<SendShortcut, AppTextKey>;

/** The hint text key for a send or save button using the chord. */
export function sendShortcutHintKey(shortcut: SendShortcut, action: "send" | "save"): AppTextKey {
  return action === "send" ? SEND_HINT_KEYS[shortcut] : SAVE_HINT_KEYS[shortcut];
}

/** The `aria-keyshortcuts` value for the chord. */
export function sendShortcutAriaKey(shortcut: SendShortcut): "Enter" | "Meta+Enter" | "Control+Enter" {
  if (shortcut === "meta-enter") return "Meta+Enter";
  if (shortcut === "ctrl-enter") return "Control+Enter";
  return "Enter";
}
