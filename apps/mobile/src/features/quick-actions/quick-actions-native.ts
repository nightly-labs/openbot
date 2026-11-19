import { type NativeModule, requireOptionalNativeModule } from "expo";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { type QuickActionItem, type QuickActionTarget, readQuickActionId } from "./model/quick-action-items";

declare class QuickActionsModule extends NativeModule<{ onQuickAction: (event: { id: string }) => void }> {
  setItems(items: QuickActionItem[]): Promise<boolean>;
}

const native = requireOptionalNativeModule<QuickActionsModule>("OpenBotQuickActions");

let listening = false;
let navigate: ((target: QuickActionTarget) => void) | null = null;
let pending: QuickActionTarget | null = null;
let signedOut = false;
let published: string | null = null;

export function installQuickActions(): void {
  if (listening || !native) return;
  listening = true;
  native.addListener("onQuickAction", ({ id }) => {
    const target = readQuickActionId(id);
    if (!target || signedOut) return;
    if (navigate) navigate(target);
    else pending = target;
  });
}

export function setQuickActionNavigator(open: (target: QuickActionTarget) => void): () => void {
  signedOut = false;
  navigate = open;
  const waiting = pending;
  pending = null;
  if (waiting) open(waiting);
  return () => {
    if (navigate === open) navigate = null;
  };
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
  signedOut = true;
  pending = null;
  void publishQuickActions([]);
}
