import {
  type AppAppearancePreference,
  type AppThemePalette,
  type ChatBackgroundColor,
  DEFAULT_APP_APPEARANCE,
  DEFAULT_TRANSPARENT_WINDOW,
  isAppAppearance,
  isAppThemePalette,
  isChatBackgroundColor,
  sameThemePalettes,
  selectedThemePalette,
} from "@openbot/contracts/app-appearance";
import {
  type AppearanceSelectValue,
  appearanceChangeOfSelectValue,
  appearanceSelectValue,
} from "@openbot/ui/features/settings/AppearanceSelect";
import { createSignal, onSettled } from "solid-js";
import { appPort } from "./app-port";
import { applyChatBackground } from "./chat-background";
import { syncColorScheme } from "./color-scheme";
import { applyThemePalette } from "./theme-palette";
import { sweepTheme } from "./theme-sweep";

/** One Settings control's value. Set optimistically, and reverted if main refuses the write. */
function optimisticChoice<T extends string | boolean | null>(initial: T, save: (next: T) => Promise<T>) {
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

function saveTheme(next: AppearanceSelectValue): Promise<AppearanceSelectValue> {
  return appPort().setAppAppearancePreference(appearanceChangeOfSelectValue(next)).then(appearanceSelectValue);
}

/** The Settings control state of the theme, the transparent window and the chat background. */
export function useAppearanceChoice() {
  const theme = optimisticChoice<AppearanceSelectValue>(DEFAULT_APP_APPEARANCE, saveTheme);
  // Each event from main carries a new array. Kobalte rebuilds its list when the options change, and
  // then reports the selected value again, so an equal list must keep the same array.
  const [palettes, setPalettes] = createSignal<AppThemePalette[]>([], { equals: sameThemePalettes });
  const transparentWindow = optimisticChoice<boolean>(DEFAULT_TRANSPARENT_WINDOW, (next) =>
    appPort()
      .setAppAppearancePreference({ transparentWindow: next })
      .then((preference) => preference.transparentWindow),
  );
  const chatBackgroundLight = optimisticChoice<ChatBackgroundColor | null>(null, (next) =>
    appPort()
      .setAppAppearancePreference({ chatBackgroundLight: next })
      .then((preference) => preference.chatBackgroundLight),
  );
  const chatBackgroundDark = optimisticChoice<ChatBackgroundColor | null>(null, (next) =>
    appPort()
      .setAppAppearancePreference({ chatBackgroundDark: next })
      .then((preference) => preference.chatBackgroundDark),
  );
  const confirm = (preference: AppAppearancePreference) => {
    setPalettes(() => preference.palettes);
    theme.confirm(appearanceSelectValue(preference));
    transparentWindow.confirm(preference.transparentWindow);
    chatBackgroundLight.confirm(preference.chatBackgroundLight);
    chatBackgroundDark.confirm(preference.chatBackgroundDark);
  };

  onSettled(() => {
    void appPort()
      .getAppAppearancePreference()
      .then(confirm)
      .catch(() => undefined);
    return appPort().onAppAppearancePreference(confirm);
  });

  return {
    theme: theme.value,
    changeTheme: theme.change,
    palettes,
    transparentWindow: transparentWindow.value,
    changeTransparentWindow: transparentWindow.change,
    chatBackgroundLight: chatBackgroundLight.value,
    changeChatBackgroundLight: chatBackgroundLight.change,
    chatBackgroundDark: chatBackgroundDark.value,
    changeChatBackgroundDark: chatBackgroundDark.change,
  };
}

/** This window's copy of the choice, so the first paint after a launch has the saved colors. */
const CACHED_APPEARANCE_KEY = "openbot.appearance";
const CACHED_TRANSPARENT_WINDOW_KEY = "openbot.transparentWindow";
/** The selected palette whole, so the first paint has its colors before main answers. */
const CACHED_THEME_PALETTE_KEY = "openbot.themePalette";
const CACHED_CHAT_BACKGROUND_LIGHT_KEY = "openbot.chatBackgroundLight";
const CACHED_CHAT_BACKGROUND_DARK_KEY = "openbot.chatBackgroundDark";

function cachedChatBackground(key: string): ChatBackgroundColor | null {
  const color = window.localStorage.getItem(key);
  return isChatBackgroundColor(color) ? color : null;
}

function cacheChatBackground(key: string, color: ChatBackgroundColor | null): void {
  if (color === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, color);
}

function cachedPalette(): AppThemePalette | null {
  const text = window.localStorage.getItem(CACHED_THEME_PALETTE_KEY);
  if (text === null) return null;
  try {
    const palette = JSON.parse(text);
    return isAppThemePalette(palette) ? palette : null;
  } catch {
    return null;
  }
}

/** Reading `window.localStorage` throws when the browser blocks storage, so it is read inside the guard. */
function cachedPreference(): AppAppearancePreference {
  try {
    const appearance = window.localStorage.getItem(CACHED_APPEARANCE_KEY);
    const palette = cachedPalette();
    return {
      appearance: isAppAppearance(appearance) ? appearance : DEFAULT_APP_APPEARANCE,
      transparentWindow: window.localStorage.getItem(CACHED_TRANSPARENT_WINDOW_KEY) === "true",
      palette: palette === null ? null : palette.id,
      palettes: palette === null ? [] : [palette],
      chatBackgroundLight: cachedChatBackground(CACHED_CHAT_BACKGROUND_LIGHT_KEY),
      chatBackgroundDark: cachedChatBackground(CACHED_CHAT_BACKGROUND_DARK_KEY),
    };
  } catch {
    return {
      appearance: DEFAULT_APP_APPEARANCE,
      transparentWindow: DEFAULT_TRANSPARENT_WINDOW,
      palette: null,
      palettes: [],
      chatBackgroundLight: null,
      chatBackgroundDark: null,
    };
  }
}

function cachePreference(preference: AppAppearancePreference): void {
  try {
    window.localStorage.setItem(CACHED_APPEARANCE_KEY, preference.appearance);
    window.localStorage.setItem(CACHED_TRANSPARENT_WINDOW_KEY, String(preference.transparentWindow));
    const palette = selectedThemePalette(preference);
    if (palette === null) window.localStorage.removeItem(CACHED_THEME_PALETTE_KEY);
    else window.localStorage.setItem(CACHED_THEME_PALETTE_KEY, JSON.stringify(palette));
    cacheChatBackground(CACHED_CHAT_BACKGROUND_LIGHT_KEY, preference.chatBackgroundLight);
    cacheChatBackground(CACHED_CHAT_BACKGROUND_DARK_KEY, preference.chatBackgroundDark);
  } catch {
    // Main's value still applies; only the next first paint can show the default.
  }
}

/**
 * Keeps a desktop window on the appearance that main keeps. The copy in browser storage gives the
 * first paint; main's value then replaces it. The Dynamic Island does not call this: it stays dark.
 * A selected theme palette gives the light or dark base, and its colors go over that base. The chat
 * background of each scheme goes over both, in conversations only.
 *
 * Only the main window passes `windowGlass`: main gives the macOS blur to that window alone, so in
 * another window a transparent page would show the desktop with no blur.
 *
 * A helper window, such as the agent dock or the browser dock, passes `sweep: false` and changes the
 * theme at once: a wash across its transparent window does not align with the main window.
 */
export function syncAppearance(options: { windowGlass?: boolean; sweep?: boolean } = {}): void {
  let preference = cachedPreference();
  const scheme = syncColorScheme(() => selectedThemePalette(preference)?.scheme ?? preference.appearance);
  applyThemePalette(selectedThemePalette(preference));
  applyChatBackground(preference);
  const showGlass = () => {
    if (options.windowGlass)
      document.documentElement.toggleAttribute("data-openbot-window-glass", preference.transparentWindow);
  };
  showGlass();
  const apply = (next: AppAppearancePreference) => {
    preference = next;
    cachePreference(next);
    scheme.refresh();
    applyThemePalette(selectedThemePalette(next));
    applyChatBackground(next);
    showGlass();
  };
  // A sweep applies its value later, so each change compares with the last value from main, and a
  // sweep applies the newest value: a fast second change cannot be replaced by an older one.
  let latest = preference;
  void appPort()
    .getAppAppearancePreference()
    .then((next) => {
      latest = next;
      apply(next);
    })
    .catch(() => undefined);
  // Main sends each saved change. A change that the window shows moves in behind a band; the first
  // value above replaces the cached copy at once, as it is not a choice the user made now.
  appPort().onAppAppearancePreference((next) => {
    const before = latest;
    latest = next;
    if (options.sweep === false || visibleLook(next) === visibleLook(before)) apply(next);
    else sweepTheme(() => apply(latest));
  });
}

/** What the window shows of a preference: the palette, or the light or dark scheme. */
function visibleLook(preference: AppAppearancePreference): string {
  const palette = selectedThemePalette(preference);
  if (palette !== null) return `palette:${palette.id}`;
  if (preference.appearance !== "system") return preference.appearance;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
