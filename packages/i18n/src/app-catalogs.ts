import type { TranslatedLocale } from "./locale";
import type { PartialTranslation } from "./message";
import { ar } from "./messages/ar/index";
import { de } from "./messages/de/index";
import { type AppMessages, en } from "./messages/en/index";
import { es } from "./messages/es/index";
import { fr } from "./messages/fr/index";
import { he } from "./messages/he/index";
import { it } from "./messages/it/index";
import { ja } from "./messages/ja/index";
import { ko } from "./messages/ko/index";
import { nl } from "./messages/nl/index";
import { pl } from "./messages/pl/index";
import { pt } from "./messages/pt/index";
import { ru } from "./messages/ru/index";
import { tr } from "./messages/tr/index";
import { zh } from "./messages/zh/index";

const catalogs = { en, ar, de, es, fr, he, it, ja, ko, nl, pl, pt, ru, tr, zh } as const;

export function appTranslation(locale: TranslatedLocale): PartialTranslation<AppMessages> | undefined {
  return catalogs[locale];
}
