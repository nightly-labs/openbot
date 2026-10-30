import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

/** How the pane of a wide window shows: the full list, or its avatars only. */
export type SplitPaneMode = "list" | "rail";

interface SplitPanePreference {
  mode: SplitPaneMode;
  /** The list width that the user dragged to, or null for the width that the window gives. */
  width: number | null;
}

const key = "openbot.mobile.split-pane.v1";

function decode(stored: string | null): SplitPanePreference {
  let value: unknown = null;
  try {
    value = stored === null ? null : JSON.parse(stored);
  } catch {
    value = null;
  }
  const fields = new Map<string, unknown>(typeof value === "object" && value !== null ? Object.entries(value) : []);
  const mode = fields.get("mode");
  const width = fields.get("width");
  return {
    mode: mode === "rail" ? "rail" : "list",
    width: typeof width === "number" && Number.isFinite(width) ? width : null,
  };
}

function read(): SplitPanePreference {
  try {
    return decode(SecureStore.getItem(key));
  } catch {
    return { mode: "list", width: null };
  }
}

export const useSplitPanePreference = create<SplitPanePreference>(read);

/** Keeps the pane as the user left it, for the next start. A failed write keeps the change for this run. */
export function setSplitPanePreference(change: Partial<SplitPanePreference>): void {
  useSplitPanePreference.setState(change);
  const { mode, width } = useSplitPanePreference.getState();
  SecureStore.setItemAsync(key, JSON.stringify({ mode, width })).catch(() => undefined);
}
