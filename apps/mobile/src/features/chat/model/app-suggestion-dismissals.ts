import * as SecureStore from "expo-secure-store";
import { z } from "zod";
import { create } from "zustand";

const key = "openbot.mobile.app-suggestion-dismissals.v1";
/**
 * The newest dismissals the phone keeps. The secure store warns above 2 KB, so the list stays short.
 * An older card shows again, which loses nothing.
 */
const MAX_DISMISSALS = 20;

const dismissalsSchema = z.array(z.string().min(1));

/** The saved list, or null when the store cannot be read, such as before the first unlock after a restart. */
function read(): string[] | null {
  try {
    const parsed = dismissalsSchema.safeParse(JSON.parse(SecureStore.getItem(key) ?? "[]"));
    return parsed.success ? parsed.data.slice(-MAX_DISMISSALS) : [];
  } catch {
    return null;
  }
}

/** The chat rows of the suggestions that the user skipped. The list remounts rows, so the state is here. */
export const useAppSuggestionDismissals = create<{ ids: readonly string[] }>(() => ({ ids: read() ?? [] }));

export function dismissAppSuggestion(messageId: string, dismissed: boolean): void {
  // The saved list joins the one in memory, so a list that could not be read at launch is not overwritten.
  const saved = read();
  const known = saved ? [...saved, ...useAppSuggestionDismissals.getState().ids] : null;
  const rest = [...new Set(known ?? useAppSuggestionDismissals.getState().ids)].filter((id) => id !== messageId);
  const ids = dismissed ? [...rest, messageId].slice(-MAX_DISMISSALS) : rest;
  useAppSuggestionDismissals.setState({ ids });
  // A store that cannot be read is not written either. The skip then lasts until the app restarts.
  if (!saved) return;
  SecureStore.setItemAsync(key, JSON.stringify(ids)).catch(() => undefined);
}
