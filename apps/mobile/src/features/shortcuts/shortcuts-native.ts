import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { type NativeModule, requireOptionalNativeModule } from "expo";
import { pendingNavigation } from "@/shared/lib/pending-navigation";
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
const opener = pendingNavigation<ShortcutOpenTarget>();

export function installShortcuts(): void {
  if (listening || !native) return;
  listening = true;
  native.addListener("onShortcutOpen", ({ payload }) => opener.receive(decodeOpenTarget(payload)));
}

export function setShortcutNavigator(open: (target: ShortcutOpenTarget) => void): () => void {
  return opener.setNavigator(open);
}

export function resetShortcuts(): void {
  opener.reset();
}
