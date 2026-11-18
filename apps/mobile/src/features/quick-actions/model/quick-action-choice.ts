import { create } from "zustand";
import * as LockedKeychain from "@/shared/lib/locked-keychain";

/** The items that the user can put on the app icon, in the order that the icon shows them. */
export const QUICK_ACTION_KINDS = ["latestChat", "secondChat", "schedule", "search", "share", "support"] as const;
export type QuickActionKind = (typeof QUICK_ACTION_KINDS)[number];

/** iOS shows four quick actions. Android launchers also show about four. */
export const QUICK_ACTION_LIMIT = 4;

const DEFAULT_KINDS: readonly QuickActionKind[] = ["latestChat", "schedule", "search", "support"];

const key = "openbot.mobile.quickActions.v1";

/** `kinds` is null until the phone reads the choice. Then the icon keeps its items, so nothing changes by mistake. */
export const useQuickActionChoice = create<{ kinds: readonly QuickActionKind[] | null }>(() => ({ kinds: null }));

/** Reads the stored value. A missing or damaged value gives the default items. */
function decodeQuickActionKinds(stored: string | null): QuickActionKind[] {
  if (stored === null) return [...DEFAULT_KINDS];
  try {
    const value = JSON.parse(stored);
    if (!Array.isArray(value)) return [...DEFAULT_KINDS];
    return QUICK_ACTION_KINDS.filter((kind) => value.includes(kind)).slice(0, QUICK_ACTION_LIMIT);
  } catch {
    return [...DEFAULT_KINDS];
  }
}

/**
 * Reads the choice once. A quick action or a notification button can start the app while the phone
 * is locked; the keychain item opens after the first unlock, so a failed read tries again later.
 */
export function loadQuickActionChoice(): void {
  if (useQuickActionChoice.getState().kinds) return;
  try {
    useQuickActionChoice.setState({ kinds: decodeQuickActionKinds(LockedKeychain.getItem(key)) });
  } catch {
    // The next screen that needs the choice reads it again.
  }
}

/** Turns one item on or off. The icon changes at once, also when the phone cannot save the choice. */
export function saveQuickActionKind(kind: QuickActionKind, enabled: boolean): Promise<void> {
  const current = useQuickActionChoice.getState().kinds;
  if (!current) return Promise.resolve();
  if (enabled && !current.includes(kind) && current.length >= QUICK_ACTION_LIMIT) return Promise.resolve();
  const kinds = QUICK_ACTION_KINDS.filter((item) => (item === kind ? enabled : current.includes(item)));
  useQuickActionChoice.setState({ kinds });
  // The keychain writes of one key run in order, so the last change stays stored.
  return LockedKeychain.setItemAsync(key, JSON.stringify(kinds));
}
