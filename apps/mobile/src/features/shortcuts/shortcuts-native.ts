import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { type NativeModule, requireOptionalNativeModule } from "expo";
import { pendingNavigation } from "@/shared/lib/pending-navigation";
import type { ShortcutOpenTarget } from "./model/shortcut-target";

declare class ShortcutsModule extends NativeModule<{ onShortcutOpen: (event: { payload: string }) => void }> {
  /** The phone has iOS 26, which the cards of the shortcuts need. */
  readonly supported: boolean;
}

/** `modules/shortcuts`. Android, Expo Go and a build without the module have no shortcuts. */
const native = requireOptionalNativeModule<ShortcutsModule>("OpenBotShortcuts");

/** The Shortcuts app of this phone has the OpenBot shortcuts. */
export const shortcutsSupported = native?.supported === true;

/** What `OpenOpenBotIntent` sends (`plugins/shortcuts/ShortcutIntents.swift`), as JSON text. */
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

/**
 * Hears the buttons of the shortcut cards from the start, so a button that starts the app waits for
 * the screens. The shortcuts themselves run in native code and need no JavaScript.
 */
export function installShortcuts(): void {
  if (listening || !native) return;
  listening = true;
  native.addListener("onShortcutOpen", ({ payload }) => opener.receive(decodeOpenTarget(payload)));
}

/** Opens the targets of the card buttons while the signed-in screens show. A target that came before opens now. */
export function setShortcutNavigator(open: (target: ShortcutOpenTarget) => void): () => void {
  return opener.setNavigator(open);
}

/** Without a session a button of a card opens nothing, also not after the next sign-in. */
export function resetShortcuts(): void {
  opener.reset();
}
