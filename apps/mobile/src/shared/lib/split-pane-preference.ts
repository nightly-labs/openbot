import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

export type SplitPaneMode = "list" | "rail";

interface SplitPanePreference {
  mode: SplitPaneMode;
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

export function setSplitPanePreference(change: Partial<SplitPanePreference>): void {
  useSplitPanePreference.setState(change);
  const { mode, width } = useSplitPanePreference.getState();
  SecureStore.setItemAsync(key, JSON.stringify({ mode, width })).catch(() => undefined);
}
