import type { TranslatedLocale } from "./locale";
import { createTranslate, type Translate } from "./message";
import { source as en } from "./messages/en/source";
import { sourceTranslation } from "./source-catalogs";
import { createSourceLocalizer } from "./source-matcher";

export type { TranslatedLocale } from "./locale";

export type SourceMessages = typeof en;

export const sourceText: Translate<SourceMessages> = createTranslate({
  source: en,
  locale: "en",
  sourceLocale: "en",
});

const localizer = createSourceLocalizer({ source: en, translation: sourceTranslation });

export function localizeSourceText(text: string, locale: TranslatedLocale): string {
  return localizer.localize(text, locale);
}

export function sourceTextValues(text: string, key: keyof SourceMessages): Readonly<Record<string, string>> | null {
  return localizer.values(text, key);
}

export function matchingSourceKeys(text: string): readonly string[] {
  return localizer.matchingKeys(text);
}

const templates: Readonly<Record<string, string | Readonly<Record<string, string>>>> = en;

export function isFixedSourceText(text: string): boolean {
  return matchingSourceKeys(text).some((key) => templates[key] === text);
}

const sourceTranslators = new Map<TranslatedLocale, Translate<SourceMessages>>();

export function sourceTranslateFor(locale: TranslatedLocale): Translate<SourceMessages> {
  const cached = sourceTranslators.get(locale);
  if (cached) return cached;
  const translation = sourceTranslation(locale);
  if (!translation) return sourceTranslateFor("en");
  const translate = createTranslate({ source: en, translation, locale, sourceLocale: "en" });
  sourceTranslators.set(locale, translate);
  return translate;
}
