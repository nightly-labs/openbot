import { type AppLanguage, DEFAULT_APP_LANGUAGE } from "@openbot/contracts/ipc";
import { type AppTranslate, resolveLocale, type TranslatedLocale, translateFor } from "@openbot/i18n";
import { createMemo, createSignal, onSettled } from "solid-js";
import { createSimpleContext } from "./simple-context";

/**
 * The language the interface reads in.
 *
 * Outermost of the providers, because every screen under it renders text, and because the value it
 * holds is owned by the main process rather than by any one screen: the native menu, the
 * notifications and this window all draw from the same saved setting. The window learns about a
 * change from `onAppLanguagePreference`, so the Dynamic Island - which has no Settings of its own -
 * follows a choice made in the main window.
 *
 * Ungated. `DEFAULT_APP_LANGUAGE` is the system language, which is what the first frame would have
 * shown anyway, so nothing waits for the read below.
 *
 * `t` reads the memo on every call, which is what makes a language change repaint the screen: a
 * component that calls `t("...")` in its JSX subscribes to the memo the same as to any signal.
 */
const I18n = createSimpleContext({
  name: "I18n",
  init: () => {
    const [language, setLanguage] = createSignal<AppLanguage>(DEFAULT_APP_LANGUAGE);
    // `navigator.language` is the renderer's view of the same value `app.getLocale()` gives main.
    const locale = createMemo<TranslatedLocale>(() => resolveLocale(language(), navigator.language));
    const translate = createMemo(() => translateFor(locale()));
    const t: AppTranslate = (key, ...params) => translate()(key, ...params);

    /** Set optimistically so the screen turns at once, and reverted if main refuses the write. */
    function changeLanguage(next: AppLanguage): void {
      const previous = language();
      setLanguage(next);
      void window.openbot
        .setAppLanguagePreference({ language: next })
        .then((preference) => setLanguage(preference.language))
        .catch(() => setLanguage(previous));
    }

    onSettled(() => {
      void window.openbot
        .getAppLanguagePreference()
        .then((preference) => setLanguage(preference.language))
        .catch(() => undefined);
      return window.openbot.onAppLanguagePreference((preference) => setLanguage(preference.language));
    });

    return { language, locale, t, changeLanguage };
  },
});

export const I18nProvider = I18n.provider;
export const useI18n = I18n.use;
