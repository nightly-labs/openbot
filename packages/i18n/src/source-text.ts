import type { TranslatedLocale } from "./locale";
import { createTranslate, type Translate } from "./message";
import { source as en } from "./messages/en/source";
import { source as fr } from "./messages/fr/source";
import { source as ja } from "./messages/ja/source";
import { createSourceLocalizer } from "./source-matcher";

export type { TranslatedLocale } from "./locale";

/**
 * Text the main process, a host or the team client sends as English, and a screen translates.
 *
 * An error crosses IPC as its message only, and the Team API sends `{ error: message }` to clients
 * of every released version. So the sender keeps writing English, byte for byte what it wrote
 * before, and the screen that shows the text maps it back to its key and renders the reader's
 * language. A remote client then reads its own language, not the host's.
 *
 * `bun run i18n:check` fails when two templates can match the same text, so the first match is the
 * only match.
 */
export type SourceMessages = typeof en;

const catalogs = { en, fr, ja } as const;

/** The English text for a source key. Write it where the code threw a literal before. */
export const sourceText: Translate<SourceMessages> = createTranslate({
  source: en,
  locale: "en",
  sourceLocale: "en",
});

const localizer = createSourceLocalizer({ source: en, translations: catalogs });

/**
 * `text` in `locale`, when it is the English of a source key. Anything else - text from an older
 * host, a provider, or a tool - is returned as it is.
 */
export function localizeSourceText(text: string, locale: TranslatedLocale): string {
  return localizer.localize(text, locale);
}

/** Every source key whose English can render `text`. `bun run i18n:check` expects one per template. */
export function matchingSourceKeys(text: string): readonly string[] {
  return localizer.matchingKeys(text);
}

const sourceTranslators = new Map<TranslatedLocale, Translate<SourceMessages>>();

/** A typed translator over the source keys, for code that picks a key itself, such as an error kind. */
export function sourceTranslateFor(locale: TranslatedLocale): Translate<SourceMessages> {
  const cached = sourceTranslators.get(locale);
  if (cached) return cached;
  const translate = createTranslate({ source: en, translation: catalogs[locale], locale, sourceLocale: "en" });
  sourceTranslators.set(locale, translate);
  return translate;
}
