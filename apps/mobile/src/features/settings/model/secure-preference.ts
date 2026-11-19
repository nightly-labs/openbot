import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

export type SwitchPreference = { enabled: boolean; ready: boolean; saving: boolean };

export function switchPreference(key: string, defaultValue: boolean) {
  const store = create<SwitchPreference>(() => ({ enabled: defaultValue, ready: false, saving: false }));
  const load = async (): Promise<void> => {
    if (store.getState().ready) return;
    try {
      const stored = await SecureStore.getItemAsync(key);
      if (!store.getState().ready)
        store.setState({ enabled: stored === String(!defaultValue) ? !defaultValue : defaultValue });
    } finally {
      store.setState({ ready: true });
    }
  };
  const save = async (enabled: boolean): Promise<void> => {
    if (!store.getState().ready || store.getState().saving) return;
    store.setState({ enabled, saving: true });
    try {
      await SecureStore.setItemAsync(key, String(enabled));
    } finally {
      store.setState({ saving: false });
    }
  };
  return { store, load, save };
}
