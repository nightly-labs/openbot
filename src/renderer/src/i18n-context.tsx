import { type AppLanguage, DEFAULT_APP_LANGUAGE } from "@openbot/contracts/app-language";
import type { HourCycle } from "@openbot/contracts/ipc";
import {
  type AppTranslate,
  formatLocale,
  loadLocale,
  localeDirection,
  localeLoaded,
  resolveLocale,
  type TranslatedLocale,
  translateFor,
} from "@openbot/i18n";
import { TextProvider } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onSettled,
  type ParentProps,
  Show,
  useContext,
} from "solid-js";
import { appPort } from "./app-port";

export interface I18nValue {
  language: () => AppLanguage;
  locale: () => TranslatedLocale;
  t: AppTranslate;
  changeLanguage: (next: AppLanguage) => void;
  hourCycle: () => HourCycle | undefined;
  ready: () => boolean;
}

interface LoadedLocale {
  shown: () => TranslatedLocale;
  ready: () => boolean;
}

function createLoadedLocale(requested: () => TranslatedLocale): LoadedLocale {
  const [loads, setLoads] = createSignal(0);
  const [failed, setFailed] = createSignal<TranslatedLocale | null>(null);
  createEffect(requested, (next) => {
    if (localeLoaded(next)) return;
    void loadLocale(next).then(
      () => setLoads((count) => count + 1),
      () => setFailed(next),
    );
  });
  const shown = createMemo<TranslatedLocale>((previous) => {
    loads();
    const next = requested();
    return localeLoaded(next) ? next : (previous ?? "en");
  });
  return {
    shown,
    ready: () => {
      loads();
      const next = requested();
      return localeLoaded(next) || failed() === next;
    },
  };
}

function createI18nValue(): I18nValue {
  const [language, setLanguage] = createSignal<AppLanguage>(DEFAULT_APP_LANGUAGE);
  const [hourCycle, setHourCycle] = createSignal<HourCycle | undefined>(undefined);
  const [hourCycleRead, setHourCycleRead] = createSignal(false);
  const [preferenceRead, setPreferenceRead] = createSignal(false);
  let confirmed: AppLanguage = DEFAULT_APP_LANGUAGE;
  let latestRequest = 0;
  let pending = 0;
  const loaded = createLoadedLocale(() => resolveLocale(language(), navigator.language));
  const locale = loaded.shown;
  const translate = createMemo(() => translateFor(locale()));
  const t: AppTranslate = (key, ...params) => translate()(key, ...params);

  createEffect(
    () => locale(),
    (value) => {
      document.documentElement.lang = value;
      document.documentElement.dir = localeDirection(value);
    },
  );

  function confirm(next: AppLanguage): void {
    confirmed = next;
    if (pending === 0) setLanguage(next);
    setPreferenceRead(true);
  }

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
        confirm(preference.language);
      })
      .catch(() => setPreferenceRead(true));
    void appPort()
      .getAppInfo()
      .then((info) => setHourCycle(info.hourCycle))
      .catch(() => undefined)
      .finally(() => setHourCycleRead(true));
    return appPort().onAppLanguagePreference((preference) => confirm(preference.language));
  });

  return {
    language,
    locale,
    t,
    changeLanguage,
    hourCycle,
    ready: () => preferenceRead() && hourCycleRead() && loaded.ready(),
  };
}

const FALLBACK: I18nValue = {
  language: () => DEFAULT_APP_LANGUAGE,
  locale: () => resolveLocale(DEFAULT_APP_LANGUAGE, navigator.language),
  t: translateFor(resolveLocale(DEFAULT_APP_LANGUAGE, navigator.language)),
  changeLanguage: () => undefined,
  hourCycle: () => undefined,
  ready: () => true,
};

const I18nContext = createContext<I18nValue>(FALLBACK, { name: "I18n" });

export function I18nProvider(props: ParentProps<{ waitForLanguage?: boolean }>): JSX.Element {
  const value = createI18nValue();
  const started = createMemo<boolean>((was) => was === true || !props.waitForLanguage || value.ready());
  return (
    <I18nContext value={value}>
      <TextProvider
        locale={value.locale()}
        formatLocale={formatLocale(value.language(), navigator.language, value.hourCycle())}
      >
        <Show when={started()}>{props.children}</Show>
      </TextProvider>
    </I18nContext>
  );
}

export function StaticI18nProvider(
  props: ParentProps<{ locale: TranslatedLocale; formatLocale?: string }>,
): JSX.Element {
  const loaded = createLoadedLocale(() => props.locale);
  const locale = loaded.shown;
  const value: I18nValue = {
    language: () => props.locale,
    locale,
    t: (key, ...params) => translateFor(locale())(key, ...params),
    changeLanguage: () => undefined,
    hourCycle: () => undefined,
    ready: loaded.ready,
  };
  createEffect(locale, (shown) => {
    const previous = document.documentElement.lang;
    const previousDirection = document.documentElement.dir;
    document.documentElement.lang = shown;
    document.documentElement.dir = localeDirection(shown);
    return () => {
      document.documentElement.lang = previous;
      document.documentElement.dir = previousDirection;
    };
  });
  return (
    <I18nContext value={value}>
      <TextProvider locale={locale()} formatLocale={props.formatLocale}>
        {props.children}
      </TextProvider>
    </I18nContext>
  );
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
