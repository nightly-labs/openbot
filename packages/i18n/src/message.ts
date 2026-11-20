import { pluralCategory } from "./plural";

export interface PluralMessage {
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

export type Message = string | PluralMessage;

type Placeholder<Text extends string> = Text extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholder<Rest>
  : never;

type MessageText<M extends Message> = M extends string ? M : Extract<M[keyof M], string>;

export type MessageParams<M extends Message> = (M extends string ? Record<never, never> : { count: number }) & {
  readonly [Name in Placeholder<MessageText<M>>]: string | number;
};

type ParamsArgument<M extends Message> =
  Record<never, never> extends MessageParams<M> ? [params?: MessageParams<M>] : [params: MessageParams<M>];

export type MessageCatalog = Readonly<Record<string, Message>>;

export type PartialTranslation<Source extends MessageCatalog> = {
  readonly [Key in keyof Source]?: TranslatedMessage<Source[Key]>;
};

type TranslatedMessage<M extends Message> = M extends string ? string : PluralMessage;

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

type MessageValue = string | number;

function interpolate(text: string, values: ReadonlyMap<string, MessageValue>): string {
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = values.get(name);
    return value === undefined ? placeholder : String(value);
  });
}

function countOf(values: ReadonlyMap<string, MessageValue> | undefined): number {
  const count = values?.get("count");
  return typeof count === "number" ? count : 0;
}

export function createTranslate<Source extends MessageCatalog>(input: {
  source: Source;
  translation?: PartialTranslation<Source> | undefined;
  locale: string;
  sourceLocale: string;
}): Translate<Source> {
  return function translate<Key extends keyof Source & string>(key: Key, ...args: ParamsArgument<Source[Key]>): string {
    const params = args[0];
    const values = params ? new Map<string, MessageValue>(Object.entries(params)) : undefined;
    const translated = input.translation?.[key];
    const message = translated ?? input.source[key];
    if (message === undefined) return key;
    const locale = translated === undefined ? input.sourceLocale : input.locale;
    const text = typeof message === "string" ? message : selectForm(message, countOf(values), locale);
    return values ? interpolate(text, values) : text;
  };
}
