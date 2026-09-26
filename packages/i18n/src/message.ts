import { pluralCategory } from "./plural";

/**
 * The message format the whole app translates through: plain strings with `{name}` placeholders,
 * plus one form per plural category where a sentence changes with a count.
 *
 * The types here are the reason there is no `t("some.key")` that silently renders nothing. A key
 * outside the catalog does not compile, and neither does a call that forgets a placeholder the
 * message needs, so a translator can move text without a reviewer checking call sites by hand.
 */

/** One form per plural category. `other` is the only form every language has, so it is required. */
export interface PluralMessage {
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

export type Message = string | PluralMessage;

/** The placeholder names in a message, read off the literal text. */
type Placeholder<Text extends string> = Text extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholder<Rest>
  : never;

/** Every literal a message can render: itself, or each of its plural forms. */
type MessageText<M extends Message> = M extends string ? M : Extract<M[keyof M], string>;

export type MessageParams<M extends Message> = (M extends string ? Record<never, never> : { count: number }) & {
  readonly [Name in Placeholder<MessageText<M>>]: string | number;
};

/** A message that needs nothing takes no second argument at all. */
type ParamsArgument<M extends Message> =
  Record<never, never> extends MessageParams<M> ? [params?: MessageParams<M>] : [params: MessageParams<M>];

export type MessageCatalog = Readonly<Record<string, Message>>;

/**
 * A translation of `Source`. Keys are optional: a key a translator has not reached yet renders its
 * English source, and `bun run i18n:check` lists it. The shape is not optional - a translation of
 * a plural message is a plural message, so a translator cannot collapse "1 reply / 2 replies"
 * into one string by mistake.
 */
export type PartialTranslation<Source extends MessageCatalog> = {
  readonly [Key in keyof Source]?: TranslatedMessage<Source[Key]>;
};

type TranslatedMessage<M extends Message> = M extends string ? string : PluralMessage;

/**
 * Declare one area's messages. Every key must start with `<prefix>.`, so two area modules spread
 * into one catalog can never overwrite each other's keys without a compile error.
 *
 * The prefix is only read by the type checker; `scripts/i18n-check.ts` checks that it matches the
 * module path.
 */
export function defineMessages<const Prefix extends string, const Messages extends MessageCatalog>(
  _prefix: Prefix,
  messages: Messages & { readonly [Key in keyof Messages]: Key extends `${Prefix}.${string}` ? Message : never },
): Messages {
  return messages;
}

export type Translate<Source extends MessageCatalog> = <Key extends keyof Source & string>(
  key: Key,
  ...params: ParamsArgument<Source[Key]>
) => string;

function selectForm(message: PluralMessage, count: number, locale: string): string {
  const category = pluralCategory(locale, count);
  return message[category] ?? message.other;
}

/** What a placeholder can be filled with. A count is read from `count` on the same object. */
type MessageValue = string | number;

function interpolate(text: string, values: ReadonlyMap<string, MessageValue>): string {
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = values.get(name);
    // The types make a missing value unreachable from this repository. Leaving the placeholder
    // visible is still better than an empty gap for a catalog loaded from a newer build.
    return value === undefined ? placeholder : String(value);
  });
}

/** The count a plural message selects its form with. Only a plural message is given one. */
function countOf(values: ReadonlyMap<string, MessageValue> | undefined): number {
  const count = values?.get("count");
  return typeof count === "number" ? count : 0;
}

/**
 * Bind a catalog to a locale.
 *
 * `translation` is the language being read; `source` is the fallback, so a key a newer catalog has
 * not translated yet renders its source text instead of disappearing.
 */
export function createTranslate<Source extends MessageCatalog>(input: {
  source: Source;
  // Partial: a key a translator has not reached, or a key this build added after the catalog was
  // written, renders its source text instead of disappearing.
  translation?: PartialTranslation<Source> | undefined;
  locale: string;
  /**
   * The language `source` is written in. Plural forms are chosen by the language of the text that
   * is actually rendered, not by the language that was asked for: a key falling back to an English
   * message and then picking its form with Japanese rules - which has one form for every count -
   * renders "1 replies".
   */
  sourceLocale: string;
}): Translate<Source> {
  return function translate<Key extends keyof Source & string>(key: Key, ...args: ParamsArgument<Source[Key]>): string {
    const params = args[0];
    // Read once into a plain map so the rendering below works on values, not on the generic
    // parameter type the caller was checked against.
    const values = params ? new Map<string, MessageValue>(Object.entries(params)) : undefined;
    const translated = input.translation?.[key];
    const message = translated ?? input.source[key];
    if (message === undefined) return key;
    const locale = translated === undefined ? input.sourceLocale : input.locale;
    const text = typeof message === "string" ? message : selectForm(message, countOf(values), locale);
    return values ? interpolate(text, values) : text;
  };
}
