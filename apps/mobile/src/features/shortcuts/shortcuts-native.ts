import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { type NativeModule, requireOptionalNativeModule } from "expo";
import type { ShortcutOpenTarget } from "./model/shortcut-target";

declare class ShortcutsModule extends NativeModule<{ onShortcutOpen: (event: { payload: string }) => void }> {
  readonly supported: boolean;
}

const native = requireOptionalNativeModule<ShortcutsModule>("OpenBotShortcuts");

export const shortcutsSupported = native?.supported === true;

function decodeOpenTarget(payload: string): ShortcutOpenTarget | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isDynamicRecord(value)) return null;
  if (value.screen === "chat" && isString(value.agentId)) {
    const draft =
      isString(value.serverId) && isString(value.text) && value.text
        ? { serverId: value.serverId, text: value.text }
        : null;
    return { screen: "chat", agentId: value.agentId, draft };
  }
  return { screen: value.screen === "settings" ? "settings" : "home" };
}

let listening = false;
let navigate: ((target: ShortcutOpenTarget) => void) | null = null;
let pending: ShortcutOpenTarget | null = null;
let signedOut = false;

export function installShortcuts(): void {
  if (listening || !native) return;
  listening = true;
  native.addListener("onShortcutOpen", ({ payload }) => {
    const target = decodeOpenTarget(payload);
    if (!target || signedOut) return;
    if (navigate) navigate(target);
    else pending = target;
  });
}

export function setShortcutNavigator(open: (target: ShortcutOpenTarget) => void): () => void {
  signedOut = false;
  navigate = open;
  const waiting = pending;
  pending = null;
  if (waiting) open(waiting);
  return () => {
    if (navigate === open) navigate = null;
  };
}

export function resetShortcuts(): void {
  signedOut = true;
  pending = null;
}
