import { type AppAppearance, DEFAULT_APP_APPEARANCE, isAppAppearance } from "@openbot/contracts/app-appearance";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { syncColorScheme } from "../../color-scheme";
import { WEB_APPEARANCE_STORAGE_KEY as STORAGE_KEY } from "./web-appearance-boot";

type AppearanceStorage = Pick<Storage, "getItem" | "setItem">;

function read(storage: AppearanceStorage | undefined): AppAppearance {
  try {
    const value = (storage ?? window.localStorage).getItem(STORAGE_KEY);
    return isAppAppearance(value) ? value : DEFAULT_APP_APPEARANCE;
  } catch {
    return DEFAULT_APP_APPEARANCE;
  }
}

export function showSavedAppearance(): () => void {
  return syncColorScheme(() => read(undefined)).stop;
}

export function createWebAppearancePreference(storage?: AppearanceStorage) {
  const [appearance, setStoredAppearance] = createSignal<AppAppearance>(read(storage));
  const scheme = syncColorScheme(appearance);
  createEffect(appearance, () => scheme.refresh());
  function listen(event: StorageEvent): void {
    if (event.key === STORAGE_KEY || event.key === null) setStoredAppearance(read(storage));
  }
  window.addEventListener("storage", listen);
  onCleanup(() => {
    window.removeEventListener("storage", listen);
    scheme.stop();
  });

  return {
    appearance,
    setAppearance(value: AppAppearance): void {
      setStoredAppearance(value);
      try {
        (storage ?? window.localStorage).setItem(STORAGE_KEY, value);
      } catch {}
    },
  };
}
