import type { TranslatedLocale } from "./locale";
import type { PartialTranslation } from "./message";
import { source as de } from "./messages/de/source";
import { source as en } from "./messages/en/source";
import { source as es } from "./messages/es/source";
import { source as fr } from "./messages/fr/source";
import { source as it } from "./messages/it/source";
import { source as ja } from "./messages/ja/source";
import { source as ko } from "./messages/ko/source";
import { source as nl } from "./messages/nl/source";
import { source as pl } from "./messages/pl/source";
import { source as pt } from "./messages/pt/source";
import { source as ru } from "./messages/ru/source";
import { source as tr } from "./messages/tr/source";
import { source as uk } from "./messages/uk/source";
import { source as zh } from "./messages/zh/source";

const catalogs = { en, de, es, fr, it, ja, ko, nl, pl, pt, ru, tr, uk, zh } as const;

/** The source catalog of `locale`, or `undefined` while it is not loaded. See `app-catalogs.ts`. */
export function sourceTranslation(locale: TranslatedLocale): PartialTranslation<typeof en> | undefined {
  return catalogs[locale];
}
