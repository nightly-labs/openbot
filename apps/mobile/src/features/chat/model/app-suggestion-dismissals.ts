import * as SecureStore from "expo-secure-store";
import { z } from "zod";
import { create } from "zustand";

const key = "openbot.mobile.app-suggestion-dismissals.v1";
const MAX_DISMISSALS = 20;

const dismissalsSchema = z.array(z.string().min(1));

function read(): string[] | null {
  try {
    const parsed = dismissalsSchema.safeParse(JSON.parse(SecureStore.getItem(key) ?? "[]"));
    return parsed.success ? parsed.data.slice(-MAX_DISMISSALS) : [];
  } catch {
    return null;
  }
}

export const useAppSuggestionDismissals = create<{ ids: readonly string[] }>(() => ({ ids: read() ?? [] }));

export function dismissAppSuggestion(messageId: string, dismissed: boolean): void {
  const saved = read();
  const known = saved ? [...saved, ...useAppSuggestionDismissals.getState().ids] : null;
  const rest = [...new Set(known ?? useAppSuggestionDismissals.getState().ids)].filter((id) => id !== messageId);
  const ids = dismissed ? [...rest, messageId].slice(-MAX_DISMISSALS) : rest;
  useAppSuggestionDismissals.setState({ ids });
  if (!saved) return;
  SecureStore.setItemAsync(key, JSON.stringify(ids)).catch(() => undefined);
}
