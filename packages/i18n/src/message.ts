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
 * A translation of `Source`. Every key is required: a catalog that quietly omits a key renders
 * English inside an otherwise translated screen, and nothing in review would catch it.
 */
export type Translation<Source extends MessageCatalog> = { readonly [Key in keyof Source]: Message };

export type Translate<Source extends MessageCatalog> = <Key extends keyof Source & string>(
  key: Key,
  ...params: ParamsArgument<Source[Key]>
) => string;

const pluralRulesByLocale = new Map<string, Intl.PluralRules>();

function pluralRules(locale: string): Intl.PluralRules {
  const cached = pluralRulesByLocale.get(locale);
  if (cached) return cached;
  // An unknown tag throws rather than falling back, and a bad stored preference must not blank the
  // interface. English rules are wrong for that language but still render a readable sentence.
  let rules: Intl.PluralRules;
  try {
    rules = new Intl.PluralRules(locale);
  } catch {
    rules = new Intl.PluralRules("en");
  }
  pluralRulesByLocale.set(locale, rules);
  return rules;
}

function selectForm(message: PluralMessage, count: number, locale: string): string {
  const category = pluralRules(locale).select(count);
  return message[category] ?? message.other;
}

/** What a placeholder can be filled with. A count is read from `count` on the same object. */
export type MessageValue = string | number;

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
  // `Partial`, because the strict "every key" rule belongs on the catalog where it is declared
  // (`satisfies Translation<AppMessages>`). Here it would only deny the fallback below its reason
  // to exist: a catalog shipped by an older build does not have a key this build just added.
  translation?: Partial<Translation<Source>> | undefined;
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
