import {
  APP_LOGO_COLOR_HEX,
  APP_LOGO_EYE_HEX,
  type AppLogoColor,
  DEFAULT_APP_LOGO_COLOR,
} from "@openbot/contracts/ipc";
import { createSignal, onSettled } from "solid-js";
import { appPort } from "./app-port";

/** Sets the release logo color and its eye color in this window. */
function applyLogoColor(color: AppLogoColor): void {
  document.documentElement.style.setProperty("--openbot-logo-production", APP_LOGO_COLOR_HEX[color]);
  document.documentElement.style.setProperty("--openbot-logo-production-eye", APP_LOGO_EYE_HEX[color]);
}

/**
 * Keeps this window on the saved logo color. Every window runs it, the Dynamic Island too, because
 * the island has no Settings of its own and main broadcasts each change to every window. Only a
 * release build applies it: some logos draw the release variant in every build, and a dev or preview
 * build keeps its own color. The preview calls the returned function when it unmounts, so the next
 * story starts from the brand tokens.
 */
export function syncLogoColor(): () => void {
  let active = true;
  const release = appPort()
    .getAppInfo()
    .then((info) => info.variant === "production")
    .catch(() => false);
  const apply = (color: AppLogoColor) => {
    void release.then((isRelease) => {
      if (active && isRelease) applyLogoColor(color);
    });
  };
  void appPort()
    .getAppLogoColorPreference()
    .then((preference) => apply(preference.color))
    .catch(() => undefined);
  const unsubscribe = appPort().onAppLogoColorPreference((preference) => apply(preference.color));
  return () => {
    active = false;
    unsubscribe();
    document.documentElement.style.removeProperty("--openbot-logo-production");
    document.documentElement.style.removeProperty("--openbot-logo-production-eye");
  };
}

/** The Settings control state. Set optimistically, and reverted if main refuses the write. */
export function useLogoColorChoice() {
  const [color, setColor] = createSignal<AppLogoColor>(DEFAULT_APP_LOGO_COLOR);
  let confirmed: AppLogoColor = DEFAULT_APP_LOGO_COLOR;
  let latestRequest = 0;
  let pending = 0;

  /** A saved value from main. A choice that is still in flight is newer, so it stays on screen. */
  function confirm(next: AppLogoColor): void {
    confirmed = next;
    if (pending === 0) setColor(next);
  }

  function changeColor(next: AppLogoColor): void {
    const request = ++latestRequest;
    pending += 1;
    setColor(next);
    void appPort()
      .setAppLogoColorPreference({ color: next })
      .then((preference) => {
        confirmed = preference.color;
        if (request === latestRequest) setColor(preference.color);
      })
      .catch(() => {
        if (request === latestRequest) setColor(confirmed);
      })
      .finally(() => {
        pending -= 1;
      });
  }

  onSettled(() => {
    void appPort()
      .getAppLogoColorPreference()
      .then((preference) => confirm(preference.color))
      .catch(() => undefined);
    return appPort().onAppLogoColorPreference((preference) => confirm(preference.color));
  });

  return { color, changeColor };
}
