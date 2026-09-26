import { type AppLanguage, DEFAULT_APP_LANGUAGE } from "@openbot/contracts/app-language";
import { type AppTranslate, formatLocale, resolveLocale, type TranslatedLocale, translateFor } from "@openbot/i18n";
import { TextProvider } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onSettled,
  type ParentProps,
  useContext,
} from "solid-js";
import { appPort } from "./app-port";

export interface I18nValue {
  language: () => AppLanguage;
  locale: () => TranslatedLocale;
  t: AppTranslate;
  changeLanguage: (next: AppLanguage) => void;
}

/**
 * Interface language, owned by main (native menu, notifications, and this window share one
 * saved setting). Outermost provider since every screen renders text. `t` reads the memo per
 * call so a language change repaints subscribers. Ungated: system language is the first frame.
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
    void appPort()
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
    void appPort()
      .getAppLanguagePreference()
      .then((preference) => {
        // A choice made before the read answered is newer than the saved value it reports, which
        // `confirm` already respects.
        confirm(preference.language);
      })
      .catch(() => undefined);
    // The main process is the owner, so what it sends is confirmed by definition - including the
    // echo of a change made in this window.
    return appPort().onAppLanguagePreference((preference) => confirm(preference.language));
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

/**
 * The language setting and the text context shared components read (`useText` from
 * `@openbot/ui/text`). A screen reads text through `useText`; only the language setting itself
 * needs `useI18n`.
 */
export function I18nProvider(props: ParentProps): JSX.Element {
  const value = createI18nValue();
  return (
    <I18nContext value={value}>
      <TextProvider locale={value.locale()} formatLocale={formatLocale(value.language(), navigator.language)}>
        {props.children}
      </TextProvider>
    </I18nContext>
  );
}

/**
 * A fixed language, for a surface without the desktop preference: the public web client before
 * sign-in, and Storybook. Resolve a browser tag with `resolveLocale("system", navigator.language)`.
 */
export function StaticI18nProvider(
  props: ParentProps<{ locale: TranslatedLocale; formatLocale?: string }>,
): JSX.Element {
  const value: I18nValue = {
    language: () => props.locale,
    locale: () => props.locale,
    t: (key, ...params) => translateFor(props.locale)(key, ...params),
    changeLanguage: () => undefined,
  };
  return (
    <I18nContext value={value}>
      <TextProvider locale={props.locale} formatLocale={props.formatLocale}>
        {props.children}
      </TextProvider>
    </I18nContext>
  );
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
