import type { TranslatedLocale } from "./locale";
import type { PartialTranslation } from "./message";
import { deMobile } from "./messages/de/mobile";
import { type AppMobileMessages, enMobile } from "./messages/en/mobile";
import { esMobile } from "./messages/es/mobile";
import { frMobile } from "./messages/fr/mobile";
import { itMobile } from "./messages/it/mobile";
import { jaMobile } from "./messages/ja/mobile";
import { koMobile } from "./messages/ko/mobile";
import { nlMobile } from "./messages/nl/mobile";
import { plMobile } from "./messages/pl/mobile";
import { ptMobile } from "./messages/pt/mobile";
import { ruMobile } from "./messages/ru/mobile";
import { trMobile } from "./messages/tr/mobile";
import { ukMobile } from "./messages/uk/mobile";
import { zhMobile } from "./messages/zh/mobile";

const catalogs = {
  de: deMobile,
  es: esMobile,
  en: enMobile,
  fr: frMobile,
  it: itMobile,
  ja: jaMobile,
  ko: koMobile,
  nl: nlMobile,
  pl: plMobile,
  pt: ptMobile,
  ru: ruMobile,
  tr: trMobile,
  uk: ukMobile,
  zh: zhMobile,
} as const;

/**
 * The mobile catalog of `locale`. The main process reads this module. Metro reads
 * `mobile-catalogs.native.ts`, which loads a language only when the app first shows it.
 */
export function mobileCatalog(locale: TranslatedLocale): PartialTranslation<AppMobileMessages> {
  return catalogs[locale];
}
