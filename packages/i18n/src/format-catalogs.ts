import type { TranslatedLocale } from "./locale";
import type { PartialTranslation } from "./message";
import { messages as de } from "./messages/de/format";
import { messages as en } from "./messages/en/format";
import { messages as es } from "./messages/es/format";
import { messages as fr } from "./messages/fr/format";
import { messages as it } from "./messages/it/format";
import { messages as ja } from "./messages/ja/format";
import { messages as ko } from "./messages/ko/format";
import { messages as nl } from "./messages/nl/format";
import { messages as pl } from "./messages/pl/format";
import { messages as pt } from "./messages/pt/format";
import { messages as ru } from "./messages/ru/format";
import { messages as tr } from "./messages/tr/format";
import { messages as uk } from "./messages/uk/format";
import { messages as zh } from "./messages/zh/format";

const catalogs = { en, de, es, fr, it, ja, ko, nl, pl, pt, ru, tr, uk, zh } as const;

/** The format catalog of `locale`, or `undefined` while it is not loaded. See `app-catalogs.ts`. */
export function formatTranslation(locale: TranslatedLocale): PartialTranslation<typeof en> | undefined {
  return catalogs[locale];
}
