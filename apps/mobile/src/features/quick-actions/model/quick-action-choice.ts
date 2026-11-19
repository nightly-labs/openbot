import { create } from "zustand";
import * as LockedKeychain from "@/shared/lib/locked-keychain";

export const QUICK_ACTION_KINDS = ["latestChat", "secondChat", "schedule", "search", "share", "support"] as const;
export type QuickActionKind = (typeof QUICK_ACTION_KINDS)[number];

export const QUICK_ACTION_LIMIT = 4;

const DEFAULT_KINDS: readonly QuickActionKind[] = ["latestChat", "schedule", "search", "support"];

const key = "openbot.mobile.quickActions.v1";

export const useQuickActionChoice = create<{ kinds: readonly QuickActionKind[] | null }>(() => ({ kinds: null }));

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

export function loadQuickActionChoice(): void {
  if (useQuickActionChoice.getState().kinds) return;
  try {
    useQuickActionChoice.setState({ kinds: decodeQuickActionKinds(LockedKeychain.getItem(key)) });
  } catch {}
}

export function saveQuickActionKind(kind: QuickActionKind, enabled: boolean): Promise<void> {
  const current = useQuickActionChoice.getState().kinds;
  if (!current) return Promise.resolve();
  if (enabled && !current.includes(kind) && current.length >= QUICK_ACTION_LIMIT) return Promise.resolve();
  const kinds = QUICK_ACTION_KINDS.filter((item) => (item === kind ? enabled : current.includes(item)));
  useQuickActionChoice.setState({ kinds });
  return LockedKeychain.setItemAsync(key, JSON.stringify(kinds));
}
