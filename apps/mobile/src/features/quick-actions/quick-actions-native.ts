import { type NativeModule, requireOptionalNativeModule } from "expo";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { pendingNavigation } from "@/shared/lib/pending-navigation";
import { type QuickActionItem, type QuickActionTarget, readQuickActionId } from "./model/quick-action-items";

declare class QuickActionsModule extends NativeModule<{ onQuickAction: (event: { id: string }) => void }> {
  setItems(items: QuickActionItem[]): Promise<boolean>;
}

const native = requireOptionalNativeModule<QuickActionsModule>("OpenBotQuickActions");

let listening = false;
const opener = pendingNavigation<QuickActionTarget>();
let published: string | null = null;

export function installQuickActions(): void {
  if (listening || !native) return;
  listening = true;
  native.addListener("onQuickAction", ({ id }) => opener.receive(readQuickActionId(id)));
}

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
  if (!saved && published === value) published = null;
}

export function resetQuickActions(): void {
  opener.reset();
  void publishQuickActions([]);
}
