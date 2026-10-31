import type { appTranslation as AppTranslation } from "./app-catalogs";
import type { formatTranslation as FormatTranslation } from "./format-catalogs";
import type { TranslatedLocale } from "./locale";
import type { loadLocale as LoadLocale, localeLoaded as LocaleLoaded } from "./locale-loading";
import { messages as enFormat } from "./messages/en/format";
import { en } from "./messages/en/index";
import { source as enSource } from "./messages/en/source";
import type { sourceTranslation as SourceTranslation } from "./source-catalogs";

/**
 * The catalogs of the public web build: `app-catalogs.ts`, `source-catalogs.ts`,
 * `format-catalogs.ts` and `locale-loading.ts` in one module, which `apps/auth-api/vite.config.ts`
 * puts in their place.
 *
 * The site shows the desktop app as a demo and as the web client. All fourteen languages are more than
 * 1 MB compressed and block the page for about a second on a phone, so English is part of the
 * bundle and each other language is a chunk that loads on first use. Each export has the type of
 * the module it replaces, so the two builds cannot drift apart.
 */

interface LocaleCatalogs {
  app: NonNullable<ReturnType<typeof AppTranslation>>;
  source: NonNullable<ReturnType<typeof SourceTranslation>>;
  format: NonNullable<ReturnType<typeof FormatTranslation>>;
}

type LoadableLocale = Exclude<TranslatedLocale, "en">;

const loaders: Record<LoadableLocale, () => Promise<LocaleCatalogs>> = {
  de: () =>
    Promise.all([import("./messages/de/index"), import("./messages/de/source"), import("./messages/de/format")]).then(
      ([app, source, format]) => ({ app: app.de, source: source.source, format: format.messages }),
    ),
  es: () =>
    Promise.all([import("./messages/es/index"), import("./messages/es/source"), import("./messages/es/format")]).then(
      ([app, source, format]) => ({ app: app.es, source: source.source, format: format.messages }),
    ),
  fr: () =>
    Promise.all([import("./messages/fr/index"), import("./messages/fr/source"), import("./messages/fr/format")]).then(
      ([app, source, format]) => ({ app: app.fr, source: source.source, format: format.messages }),
    ),
  it: () =>
    Promise.all([import("./messages/it/index"), import("./messages/it/source"), import("./messages/it/format")]).then(
      ([app, source, format]) => ({ app: app.it, source: source.source, format: format.messages }),
    ),
  ja: () =>
    Promise.all([import("./messages/ja/index"), import("./messages/ja/source"), import("./messages/ja/format")]).then(
      ([app, source, format]) => ({ app: app.ja, source: source.source, format: format.messages }),
    ),
  ko: () =>
    Promise.all([import("./messages/ko/index"), import("./messages/ko/source"), import("./messages/ko/format")]).then(
      ([app, source, format]) => ({ app: app.ko, source: source.source, format: format.messages }),
    ),
  nl: () =>
    Promise.all([import("./messages/nl/index"), import("./messages/nl/source"), import("./messages/nl/format")]).then(
      ([app, source, format]) => ({ app: app.nl, source: source.source, format: format.messages }),
    ),
  pl: () =>
    Promise.all([import("./messages/pl/index"), import("./messages/pl/source"), import("./messages/pl/format")]).then(
      ([app, source, format]) => ({ app: app.pl, source: source.source, format: format.messages }),
    ),
  pt: () =>
    Promise.all([import("./messages/pt/index"), import("./messages/pt/source"), import("./messages/pt/format")]).then(
      ([app, source, format]) => ({ app: app.pt, source: source.source, format: format.messages }),
    ),
  ru: () =>
    Promise.all([import("./messages/ru/index"), import("./messages/ru/source"), import("./messages/ru/format")]).then(
      ([app, source, format]) => ({ app: app.ru, source: source.source, format: format.messages }),
    ),
  tr: () =>
    Promise.all([import("./messages/tr/index"), import("./messages/tr/source"), import("./messages/tr/format")]).then(
      ([app, source, format]) => ({ app: app.tr, source: source.source, format: format.messages }),
    ),
  uk: () =>
    Promise.all([import("./messages/uk/index"), import("./messages/uk/source"), import("./messages/uk/format")]).then(
      ([app, source, format]) => ({ app: app.uk, source: source.source, format: format.messages }),
    ),
  zh: () =>
    Promise.all([import("./messages/zh/index"), import("./messages/zh/source"), import("./messages/zh/format")]).then(
      ([app, source, format]) => ({ app: app.zh, source: source.source, format: format.messages }),
    ),
};

const loaded = new Map<TranslatedLocale, LocaleCatalogs>([["en", { app: en, source: enSource, format: enFormat }]]);
const loading = new Map<LoadableLocale, Promise<void>>();

export const appTranslation: typeof AppTranslation = (locale) => loaded.get(locale)?.app;
export const sourceTranslation: typeof SourceTranslation = (locale) => loaded.get(locale)?.source;
export const formatTranslation: typeof FormatTranslation = (locale) => loaded.get(locale)?.format;
export const localeLoaded: typeof LocaleLoaded = (locale) => loaded.has(locale);

/** A failed load is not kept, so the next request for the language tries again. */
export const loadLocale: typeof LoadLocale = (locale) => {
  if (locale === "en" || loaded.has(locale)) return Promise.resolve();
  const pending = loading.get(locale);
  if (pending) return pending;
  const next = loaders[locale]().then(
    (catalogs) => {
      loaded.set(locale, catalogs);
      loading.delete(locale);
    },
    (error: unknown) => {
      loading.delete(locale);
      throw error;
    },
  );
  loading.set(locale, next);
  return next;
};
