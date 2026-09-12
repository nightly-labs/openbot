import { type AppLanguage, DEFAULT_APP_LANGUAGE } from "@openbot/contracts/ipc";
import { type AppTranslate, resolveLocale, type TranslatedLocale, translateFor } from "@openbot/i18n";
import { createContext, createMemo, createSignal, onSettled, type ParentProps, useContext } from "solid-js";

export interface I18nValue {
  language: () => AppLanguage;
  locale: () => TranslatedLocale;
  t: AppTranslate;
  changeLanguage: (next: AppLanguage) => void;
}

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
function createI18nValue(): I18nValue {
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
}

/**
 * The one context with a value outside its provider, which is why it is written by hand instead of
 * through `createSimpleContext`.
 *
 * Every component in the app renders text, so `t` is about to be read from hundreds of files - and
 * a component rendered on its own, in a unit test or in a story, still has to draw. The other
 * domains have no honest answer outside their provider and rightly throw; this one does: the
 * language of the computer, which is what the app shows until someone chooses otherwise. Reading
 * the system language is never wrong here, only fixed - the fallback cannot follow a change,
 * because nothing outside the provider subscribed to one.
 *
 * `changeLanguage` is deliberately inert in the fallback. A component that offers the setting is
 * the app's own Settings screen, which is always inside the provider.
 */
const FALLBACK: I18nValue = {
  language: () => DEFAULT_APP_LANGUAGE,
  locale: () => resolveLocale(DEFAULT_APP_LANGUAGE, navigator.language),
  t: translateFor(resolveLocale(DEFAULT_APP_LANGUAGE, navigator.language)),
  changeLanguage: () => undefined,
};

const I18nContext = createContext<I18nValue>(FALLBACK, { name: "I18n" });

export function I18nProvider(props: ParentProps) {
  const value = createI18nValue();
  return <I18nContext value={value}>{props.children}</I18nContext>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
