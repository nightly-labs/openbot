import type { TranslatedLocale } from "./locale";
import { createTranslate, type Message, type MessageCatalog, type PartialTranslation, type Translate } from "./message";

/**
 * Map English text back to its key, then render the key in another language.
 *
 * Each English template compiles to one anchored pattern: `{count}` matches a number, and any other
 * placeholder matches the shortest text that lets the rest of the template match. Text that no
 * template matches - from an older host, a provider, or a tool - is returned as it is.
 */
export interface SourceLocalizer {
  localize: (text: string, locale: TranslatedLocale) => string;
  /** Every key whose English can render `text`. A template that is not unique is a catalog bug. */
  matchingKeys: (text: string) => readonly string[];
}

interface Template {
  readonly key: string;
  readonly pattern: RegExp;
  readonly names: readonly string[];
}

/** Placeholders whose value is itself text from a sender, so it is translated in turn. */
const NESTED_PLACEHOLDERS = new Set(["reason", "detail"]);
const MAX_NESTING = 2;
/** Templates are grouped by this many leading characters, so a lookup tries only a few. */
const BUCKET_LENGTH = 4;
const CACHE_LIMIT = 256;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function forms(message: Message): readonly string[] {
  if (typeof message === "string") return [message];
  return [message.zero, message.one, message.two, message.few, message.many, message.other].filter(
    (form): form is string => form !== undefined,
  );
}

/**
 * `{count}` is a number. `{reason}` and `{detail}` hold another message, which can have more than one
 * line. Other values are one line, so a template without a `\n{detail}` tail cannot match the text of
 * the template that has one.
 */
function placeholderPattern(name: string) {
  if (name === "count") return "(-?\\d+(?:\\.\\d+)?)";
  if (name === "reason" || name === "detail") return "([\\s\\S]+?)";
  return "([^\\n]+?)";
}

function compile(key: string, text: string): Template {
  const names: string[] = [];
  let pattern = "";
  let last = 0;
  for (const match of text.matchAll(/\{(\w+)\}/g)) {
    const name = match[1] ?? "";
    pattern += escapeRegExp(text.slice(last, match.index));
    pattern += placeholderPattern(name);
    names.push(name);
    last = match.index + match[0].length;
  }
  pattern += escapeRegExp(text.slice(last));
  return { key, pattern: new RegExp(`^${pattern}$`), names };
}

/** The literal text before the first placeholder. */
function literalPrefix(text: string): string {
  const brace = text.indexOf("{");
  return brace === -1 ? text : text.slice(0, brace);
}

export function createSourceLocalizer(input: {
  source: MessageCatalog;
  translations: Readonly<Record<TranslatedLocale, PartialTranslation<MessageCatalog>>>;
}): SourceLocalizer {
  let byPrefix: Map<string, Template[]> | undefined;
  /** Templates whose literal prefix is shorter than a bucket. Every lookup tries these. */
  const unbucketed: Template[] = [];

  // Compiled on first use: most sessions never show a host error.
  function buckets(): ReadonlyMap<string, readonly Template[]> {
    if (byPrefix) return byPrefix;
    byPrefix = new Map();
    for (const [key, message] of Object.entries(input.source)) {
      for (const text of forms(message)) {
        const template = compile(key, text);
        const prefix = literalPrefix(text);
        if (prefix.length < BUCKET_LENGTH) {
          unbucketed.push(template);
          continue;
        }
        const bucket = prefix.slice(0, BUCKET_LENGTH);
        byPrefix.set(bucket, [...(byPrefix.get(bucket) ?? []), template]);
      }
    }
    return byPrefix;
  }

  function candidates(text: string): readonly Template[] {
    return [...(buckets().get(text.slice(0, BUCKET_LENGTH)) ?? []), ...unbucketed];
  }

  const translators = new Map<TranslatedLocale, Translate<MessageCatalog>>();

  // Typed on the wide catalog: a matched template brings values read off the text, not values the
  // compiler checked against the key's parameters.
  function translatorFor(locale: TranslatedLocale): Translate<MessageCatalog> {
    const cached = translators.get(locale);
    if (cached) return cached;
    const translate = createTranslate<MessageCatalog>({
      source: input.source,
      translation: input.translations[locale],
      locale,
      sourceLocale: "en",
    });
    translators.set(locale, translate);
    return translate;
  }

  function localize(text: string, locale: TranslatedLocale, depth: number): string {
    for (const template of candidates(text)) {
      const match = template.pattern.exec(text);
      if (!match) continue;
      const values = new Map<string, string | number>();
      template.names.forEach((name, position) => {
        const value = match[position + 1] ?? "";
        if (name === "count") values.set(name, Number(value));
        else if (NESTED_PLACEHOLDERS.has(name) && depth < MAX_NESTING)
          values.set(name, localize(value, locale, depth + 1));
        else values.set(name, value);
      });
      return translatorFor(locale)(template.key, Object.fromEntries(values));
    }
    return text;
  }

  const cache = new Map<string, string>();

  return {
    localize: (text, locale) => {
      if (locale === "en") return text;
      const cacheKey = `${locale}\u0000${text}`;
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        // Move the entry to the end, so the oldest entry is the first one dropped.
        cache.delete(cacheKey);
        cache.set(cacheKey, cached);
        return cached;
      }
      const localized = localize(text, locale, 0);
      cache.set(cacheKey, localized);
      if (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      return localized;
    },
    matchingKeys: (text) =>
      candidates(text)
        .filter((template) => template.pattern.test(text))
        .map((template) => template.key),
  };
}
