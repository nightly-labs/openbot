import type { QuoteShortcutModifier } from "@openbot/ui/features/conversation/SelectionActions";
import {
  parseSendShortcutMode,
  resolveSendShortcut,
  type SendShortcut,
  type SendShortcutMode,
  sendShortcutAriaKey,
  sendShortcutHintKey,
} from "@openbot/ui/features/conversation/send-shortcut";
import { createSignal } from "solid-js";

export { sendShortcutAriaKey, sendShortcutHintKey };

const SEND_SHORTCUT_STORAGE_KEY = "openbot:send-shortcut-mode";

export type { SendShortcutMode };

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

let unsavedPreference: SendShortcutMode | undefined;

export function readSendShortcutMode(storage?: PreferenceStorage): SendShortcutMode {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    return parseSendShortcutMode((storage ?? window.localStorage).getItem(SEND_SHORTCUT_STORAGE_KEY));
  } catch {
    return "enter";
  }
}

function writeSendShortcutMode(mode: SendShortcutMode, storage?: PreferenceStorage): void {
  try {
    (storage ?? window.localStorage).setItem(SEND_SHORTCUT_STORAGE_KEY, mode);
    unsavedPreference = undefined;
  } catch {
    unsavedPreference = mode;
  }
}

function devicePlatform(userAgentDataPlatform?: string, fallbackPlatform?: string): "darwin" | "win32" | "linux" {
  const platform = (userAgentDataPlatform ?? fallbackPlatform ?? "").toLowerCase();
  if (platform.includes("mac")) return "darwin";
  if (platform.includes("win")) return "win32";
  return "linux";
}

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
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

export function useSendShortcutMode(): () => SendShortcutMode {
  return sendShortcutMode;
}

export function setSendShortcutMode(mode: SendShortcutMode): void {
  writeSendShortcutMode(mode);
  setSendShortcutModeSignal(mode);
}

export function deviceSendShortcut(appPlatform?: "darwin" | "win32" | "linux"): SendShortcut {
  return resolveSendShortcut(sendShortcutMode(), appPlatform ?? currentDevicePlatform());
}

export function deviceQuoteShortcut(appPlatform?: "darwin" | "win32" | "linux"): QuoteShortcutModifier {
  return (appPlatform ?? currentDevicePlatform()) === "darwin" ? "meta" : "ctrl";
}
