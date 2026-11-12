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

function read(): string[] {
  try {
    const parsed = dismissalsSchema.safeParse(JSON.parse(SecureStore.getItem(key) ?? "[]"));
    return parsed.success ? parsed.data.slice(-MAX_DISMISSALS) : [];
  } catch {
    return [];
  }
}

/** The chat rows of the suggestions that the user skipped. The list remounts rows, so the state is here. */
export const useAppSuggestionDismissals = create<{ ids: readonly string[] }>(() => ({ ids: read() }));

export function dismissAppSuggestion(messageId: string, dismissed: boolean): void {
  const rest = useAppSuggestionDismissals.getState().ids.filter((id) => id !== messageId);
  const ids = dismissed ? [...rest, messageId].slice(-MAX_DISMISSALS) : rest;
  useAppSuggestionDismissals.setState({ ids });
  try {
    SecureStore.setItem(key, JSON.stringify(ids));
  } catch {
    // A skip must not fail when the store is unavailable. It lasts until the app restarts then.
  }
}
