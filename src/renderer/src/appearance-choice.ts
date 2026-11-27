import {
  type AppAppearancePreference,
  type AppFontFamily,
  type AppThemePalette,
  type ChatBackgroundColor,
  DEFAULT_APP_APPEARANCE,
  DEFAULT_TRANSPARENT_WINDOW,
  isAppAppearance,
  isAppFontFamily,
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
import { applyAppFonts } from "./app-fonts";
import { appPort } from "./app-port";
import { applyChatBackground } from "./chat-background";
import { syncColorScheme } from "./color-scheme";
import { applyThemePalette } from "./theme-palette";
import { sweepTheme } from "./theme-sweep";
import { setWindowGlass } from "./window-glass";

function optimisticChoice<T extends string | boolean | null>(initial: T, save: (next: T) => Promise<T>) {
  const [value, setValue] = createSignal<T>(() => initial);
  let confirmed = initial;
  let latestRequest = 0;
  let pending = 0;

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

export function useAppearanceChoice() {
  const theme = optimisticChoice<AppearanceSelectValue>(DEFAULT_APP_APPEARANCE, saveTheme);
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
  const interfaceFont = optimisticChoice<AppFontFamily | null>(null, (next) =>
    appPort()
      .setAppAppearancePreference({ interfaceFont: next })
      .then((preference) => preference.interfaceFont),
  );
  const codeFont = optimisticChoice<AppFontFamily | null>(null, (next) =>
    appPort()
      .setAppAppearancePreference({ codeFont: next })
      .then((preference) => preference.codeFont),
  );
  const confirm = (preference: AppAppearancePreference) => {
    setPalettes(() => preference.palettes);
    theme.confirm(appearanceSelectValue(preference));
    transparentWindow.confirm(preference.transparentWindow);
    chatBackgroundLight.confirm(preference.chatBackgroundLight);
    chatBackgroundDark.confirm(preference.chatBackgroundDark);
    interfaceFont.confirm(preference.interfaceFont);
    codeFont.confirm(preference.codeFont);
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
    interfaceFont: interfaceFont.value,
    changeInterfaceFont: interfaceFont.change,
    codeFont: codeFont.value,
    changeCodeFont: codeFont.change,
  };
}

const CACHED_APPEARANCE_KEY = "openbot.appearance";
const CACHED_TRANSPARENT_WINDOW_KEY = "openbot.transparentWindow";
const CACHED_THEME_PALETTE_KEY = "openbot.themePalette";
const CACHED_CHAT_BACKGROUND_LIGHT_KEY = "openbot.chatBackgroundLight";
const CACHED_CHAT_BACKGROUND_DARK_KEY = "openbot.chatBackgroundDark";
const CACHED_INTERFACE_FONT_KEY = "openbot.interfaceFont";
const CACHED_CODE_FONT_KEY = "openbot.codeFont";

function cachedFont(key: string): AppFontFamily | null {
  const font = window.localStorage.getItem(key);
  return isAppFontFamily(font) ? font : null;
}

function cacheFont(key: string, font: AppFontFamily | null): void {
  if (font === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, font);
}

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
      interfaceFont: cachedFont(CACHED_INTERFACE_FONT_KEY),
      codeFont: cachedFont(CACHED_CODE_FONT_KEY),
    };
  } catch {
    return {
      appearance: DEFAULT_APP_APPEARANCE,
      transparentWindow: DEFAULT_TRANSPARENT_WINDOW,
      palette: null,
      palettes: [],
      chatBackgroundLight: null,
      chatBackgroundDark: null,
      interfaceFont: null,
      codeFont: null,
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
    cacheFont(CACHED_INTERFACE_FONT_KEY, preference.interfaceFont);
    cacheFont(CACHED_CODE_FONT_KEY, preference.codeFont);
  } catch {}
}

export function syncAppearance(options: { windowGlass?: boolean; sweep?: boolean } = {}): void {
  let preference = cachedPreference();
  const scheme = syncColorScheme(() => selectedThemePalette(preference)?.scheme ?? preference.appearance);
  applyThemePalette(selectedThemePalette(preference));
  applyChatBackground(preference);
  applyAppFonts(preference);
  const showGlass = () => {
    if (options.windowGlass) setWindowGlass("transparent-window", preference.transparentWindow);
  };
  showGlass();
  const apply = (next: AppAppearancePreference) => {
    preference = next;
    cachePreference(next);
    scheme.refresh();
    applyThemePalette(selectedThemePalette(next));
    applyChatBackground(next);
    applyAppFonts(next);
    showGlass();
  };
  let latest = preference;
  void appPort()
    .getAppAppearancePreference()
    .then((next) => {
      latest = next;
      apply(next);
    })
    .catch(() => undefined);
  appPort().onAppAppearancePreference((next) => {
    const before = latest;
    latest = next;
    if (options.sweep === false || visibleLook(next) === visibleLook(before)) apply(next);
    else sweepTheme(() => apply(latest));
  });
}

function visibleLook(preference: AppAppearancePreference): string {
  const palette = selectedThemePalette(preference);
  if (palette !== null) return `palette:${palette.id}`;
  if (preference.appearance !== "system") return preference.appearance;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
