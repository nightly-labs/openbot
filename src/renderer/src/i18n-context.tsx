import { type AppLanguage, DEFAULT_APP_LANGUAGE } from "@openbot/contracts/ipc";
import { type AppTranslate, resolveLocale, type TranslatedLocale, translateFor } from "@openbot/i18n";
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onSettled,
  type ParentProps,
  useContext,
} from "solid-js";

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
  // The last value the main process confirmed, which is what a failed write falls back to. The
  // displayed language runs ahead of it while a write is in flight.
  let confirmed: AppLanguage = DEFAULT_APP_LANGUAGE;
  // Counts the choices made, so a reply that is no longer the latest one cannot move the screen.
  // Two quick choices whose writes both fail would otherwise leave the screen on the first of them
  // while the saved preference, the menu and the notifications read in the confirmed language.
  let latestRequest = 0;
  // How many writes are in flight. While one is, the screen already shows the newest choice, and a
  // value arriving from main is older than it.
  let pending = 0;
  // `navigator.language` is the renderer's view of the same value `app.getLocale()` gives main.
  const locale = createMemo<TranslatedLocale>(() => resolveLocale(language(), navigator.language));
  const translate = createMemo(() => translateFor(locale()));
  const t: AppTranslate = (key, ...params) => translate()(key, ...params);

  // `index.html` declares one language, so the document would keep saying English through every
  // change. A screen reader takes the voice for a control from the nearest `lang`, and reads
  // Japanese text with an English voice when the two disagree.
  createEffect(
    () => locale(),
    (value) => {
      document.documentElement.lang = value;
    },
  );

  function confirm(next: AppLanguage): void {
    confirmed = next;
    if (pending === 0) setLanguage(next);
  }

  /** Set optimistically so the screen turns at once, and reverted if main refuses the write. */
  function changeLanguage(next: AppLanguage): void {
    const request = ++latestRequest;
    pending += 1;
    setLanguage(next);
    void window.openbot
      .setAppLanguagePreference({ language: next })
      .then((preference) => {
        confirmed = preference.language;
        if (request === latestRequest) setLanguage(preference.language);
      })
      .catch(() => {
        if (request === latestRequest) setLanguage(confirmed);
      })
      .finally(() => {
        pending -= 1;
      });
  }

  onSettled(() => {
    void window.openbot
      .getAppLanguagePreference()
      .then((preference) => {
        // A choice made before the read answered is newer than the saved value it reports, which
        // `confirm` already respects.
        confirm(preference.language);
      })
      .catch(() => undefined);
    // The main process is the owner, so what it sends is confirmed by definition - including the
    // echo of a change made in this window.
    return window.openbot.onAppLanguagePreference((preference) => confirm(preference.language));
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
