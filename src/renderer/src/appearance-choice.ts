import {
  type AppAppearance,
  type AppAppearancePreference,
  DEFAULT_APP_APPEARANCE,
  DEFAULT_TRANSPARENT_WINDOW,
  isAppAppearance,
} from "@openbot/contracts/app-appearance";
import { createSignal, onSettled } from "solid-js";
import { appPort } from "./app-port";
import { syncColorScheme } from "./color-scheme";

/** One Settings control's value. Set optimistically, and reverted if main refuses the write. */
function optimisticChoice<T extends string | boolean>(initial: T, save: (next: T) => Promise<T>) {
  const [value, setValue] = createSignal<T>(() => initial);
  let confirmed = initial;
  let latestRequest = 0;
  let pending = 0;

  /** A saved value from main. A choice that is still in flight is newer, so it stays on screen. */
  function confirm(next: T): void {
    confirmed = next;
    if (pending === 0) setValue(() => next);
  }

  function change(next: T): void {
    const request = ++latestRequest;
    pending += 1;
    setValue(() => next);
    void save(next)
      .then((saved) => {
        confirmed = saved;
        if (request === latestRequest) setValue(() => saved);
      })
      .catch(() => {
        if (request === latestRequest) setValue(() => confirmed);
      })
      .finally(() => {
        pending -= 1;
      });
  }

  return { value, confirm, change };
}

/** The Settings control state of the theme and of the transparent window. */
export function useAppearanceChoice() {
  const appearance = optimisticChoice<AppAppearance>(DEFAULT_APP_APPEARANCE, (next) =>
    appPort()
      .setAppAppearancePreference({ appearance: next })
      .then((preference) => preference.appearance),
  );
  const transparentWindow = optimisticChoice<boolean>(DEFAULT_TRANSPARENT_WINDOW, (next) =>
    appPort()
      .setAppAppearancePreference({ transparentWindow: next })
      .then((preference) => preference.transparentWindow),
  );
  const confirm = (preference: AppAppearancePreference) => {
    appearance.confirm(preference.appearance);
    transparentWindow.confirm(preference.transparentWindow);
  };

  onSettled(() => {
    void appPort()
      .getAppAppearancePreference()
      .then(confirm)
      .catch(() => undefined);
    return appPort().onAppAppearancePreference(confirm);
  });

  return {
    appearance: appearance.value,
    changeAppearance: appearance.change,
    transparentWindow: transparentWindow.value,
    changeTransparentWindow: transparentWindow.change,
  };
}

/** This window's copy of the choice, so the first paint after a launch has the saved colors. */
const CACHED_APPEARANCE_KEY = "openbot.appearance";
const CACHED_TRANSPARENT_WINDOW_KEY = "openbot.transparentWindow";

/** Reading `window.localStorage` throws when the browser blocks storage, so it is read inside the guard. */
function cachedPreference(): AppAppearancePreference {
  try {
    const appearance = window.localStorage.getItem(CACHED_APPEARANCE_KEY);
    return {
      appearance: isAppAppearance(appearance) ? appearance : DEFAULT_APP_APPEARANCE,
      transparentWindow: window.localStorage.getItem(CACHED_TRANSPARENT_WINDOW_KEY) === "true",
    };
  } catch {
    return { appearance: DEFAULT_APP_APPEARANCE, transparentWindow: DEFAULT_TRANSPARENT_WINDOW };
  }
}

/**
 * Keeps a desktop window on the appearance that main keeps. The copy in browser storage gives the
 * first paint; main's value then replaces it. The Dynamic Island does not call this: it stays dark.
 *
 * Only the main window passes `windowGlass`: main gives the macOS blur to that window alone, so in
 * another window a transparent page would show the desktop with no blur.
 */
export function syncAppearance(options: { windowGlass?: boolean } = {}): void {
  let preference = cachedPreference();
  const scheme = syncColorScheme(() => preference.appearance);
  const showGlass = () => {
    if (options.windowGlass)
      document.documentElement.toggleAttribute("data-openbot-window-glass", preference.transparentWindow);
  };
  showGlass();
  const apply = (next: AppAppearancePreference) => {
    preference = next;
    try {
      window.localStorage.setItem(CACHED_APPEARANCE_KEY, next.appearance);
      window.localStorage.setItem(CACHED_TRANSPARENT_WINDOW_KEY, String(next.transparentWindow));
    } catch {
      // Main's value still applies; only the next first paint can show the default.
    }
    scheme.refresh();
    showGlass();
  };
  void appPort()
    .getAppAppearancePreference()
    .then(apply)
    .catch(() => undefined);
  appPort().onAppAppearancePreference(apply);
}
