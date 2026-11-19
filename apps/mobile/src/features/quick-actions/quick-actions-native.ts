import { type NativeModule, requireOptionalNativeModule } from "expo";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { pendingNavigation } from "@/shared/lib/pending-navigation";
import { type QuickActionItem, type QuickActionTarget, readQuickActionId } from "./model/quick-action-items";

declare class QuickActionsModule extends NativeModule<{ onQuickAction: (event: { id: string }) => void }> {
  /** Returns false when the phone keeps the old items. */
  setItems(items: QuickActionItem[]): Promise<boolean>;
}

/** `modules/quick-actions`. A build without it, such as Expo Go, has no quick actions. */
const native = requireOptionalNativeModule<QuickActionsModule>("OpenBotQuickActions");

let listening = false;
const opener = pendingNavigation<QuickActionTarget>();
/** The items that the phone has. Android limits the updates of an app in the background. */
let published: string | null = null;

/** Hears the chosen actions from the start, so the action that starts the app waits for the screens. */
export function installQuickActions(): void {
  if (listening || !native) return;
  listening = true;
  native.addListener("onQuickAction", ({ id }) => opener.receive(readQuickActionId(id)));
}

/** Opens the chosen actions while the signed-in screens show. An action that came before opens now. */
export function setQuickActionNavigator(open: (target: QuickActionTarget) => void): () => void {
  return opener.setNavigator(open);
}

export async function publishQuickActions(items: readonly QuickActionItem[]): Promise<void> {
  const value = JSON.stringify(items);
  if (!native || value === published) return;
  published = value;
  let saved = false;
  try {
    saved = await native.setItems([...items]);
  } catch (error) {
    supportLog.add("warn", "app", `Quick actions not saved: ${supportLogValue(error)}`);
  }
  // The next change tries again.
  if (!saved && published === value) published = null;
}

/** Without a session the icon offers nothing, and an action chosen before does not open after sign-in. */
export function resetQuickActions(): void {
  opener.reset();
  void publishQuickActions([]);
}
