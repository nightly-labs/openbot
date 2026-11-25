import { createSignal } from "solid-js";
import { z } from "zod";

const MARKETPLACE_SUGGESTION_DISMISSALS_KEY = "openbot:marketplace-suggestion-dismissals:v1";
const MAX_DISMISSALS = 200;

type DismissalStorage = Pick<Storage, "getItem" | "setItem">;

const dismissalsSchema = z.array(z.string().min(1)).max(MAX_DISMISSALS);

function readDismissals(storage: DismissalStorage): string[] {
  try {
    const parsed = dismissalsSchema.safeParse(
      JSON.parse(storage.getItem(MARKETPLACE_SUGGESTION_DISMISSALS_KEY) ?? "[]"),
    );
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

const [dismissals, setDismissals] = createSignal<readonly string[]>(readDismissals(window.localStorage));

export function marketplaceSuggestionDismissed(messageId: string): boolean {
  return dismissals().includes(messageId);
}

export function dismissMarketplaceSuggestion(messageId: string, dismissed: boolean): void {
  const rest = dismissals().filter((id) => id !== messageId);
  const next = dismissed ? [...rest, messageId].slice(-MAX_DISMISSALS) : rest;
  setDismissals(next);
  try {
    window.localStorage.setItem(MARKETPLACE_SUGGESTION_DISMISSALS_KEY, JSON.stringify(next));
  } catch {}
}
