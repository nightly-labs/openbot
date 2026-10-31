import type { TranslatedLocale } from "./locale";
import type { PartialTranslation } from "./message";
import { de } from "./messages/de/index";
import { type AppMessages, en } from "./messages/en/index";
import { es } from "./messages/es/index";
import { fr } from "./messages/fr/index";
import { it } from "./messages/it/index";
import { ja } from "./messages/ja/index";
import { ko } from "./messages/ko/index";
import { nl } from "./messages/nl/index";
import { pl } from "./messages/pl/index";
import { pt } from "./messages/pt/index";
import { ru } from "./messages/ru/index";
import { tr } from "./messages/tr/index";
import { zh } from "./messages/zh/index";
import { zhTW } from "./messages/zh-TW/index";

const catalogs = { en, de, es, fr, it, ja, ko, nl, pl, pt, ru, tr, zh, "zh-TW": zhTW } as const;

/**
 * The desktop catalog of `locale`, or `undefined` while it is not loaded.
 *
 * This build holds every language. The public web build replaces this module with
 * `lazy-catalogs.ts`, which holds English and loads another language on first use.
 */
export function appTranslation(locale: TranslatedLocale): PartialTranslation<AppMessages> | undefined {
  return catalogs[locale];
}
