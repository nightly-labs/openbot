import type { TranslatedLocale } from "./locale";
import { createTranslate, type Message, type MessageCatalog, type PartialTranslation, type Translate } from "./message";

export interface SourceLocalizer {
  localize: (text: string, locale: TranslatedLocale) => string;
  matchingKeys: (text: string) => readonly string[];
}

interface Template {
  readonly key: string;
  readonly pattern: RegExp;
  readonly names: readonly string[];
}

const NESTED_PLACEHOLDERS = new Set(["reason", "detail"]);
const MAX_NESTING = 2;
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

function literalPrefix(text: string): string {
  const brace = text.indexOf("{");
  return brace === -1 ? text : text.slice(0, brace);
}

export function createSourceLocalizer(input: {
  source: MessageCatalog;
  translation: (locale: TranslatedLocale) => PartialTranslation<MessageCatalog> | undefined;
}): SourceLocalizer {
  let byPrefix: Map<string, Template[]> | undefined;
  const unbucketed: Template[] = [];

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

  function translatorFor(locale: TranslatedLocale): Translate<MessageCatalog> {
    const cached = translators.get(locale);
    if (cached) return cached;
    const translate = createTranslate<MessageCatalog>({
      source: input.source,
      translation: input.translation(locale),
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
      if (locale === "en" || !input.translation(locale)) return text;
      const cacheKey = `${locale}\u0000${text}`;
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
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
