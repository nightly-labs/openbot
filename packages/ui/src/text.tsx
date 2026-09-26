import {
  type AppFormat,
  type AppTranslate,
  createFormat,
  localizeSourceText,
  type TranslatedLocale,
  translateFor,
} from "@openbot/i18n";
import { userErrorMessage } from "@openbot/user-errors";
import type { JSX } from "@solidjs/web";
import { createContext, createEffect, createSignal, type ParentProps, useContext } from "solid-js";

/**
 * The interface language, as shared components read it.
 *
 * This is the one application value `@openbot/ui` reads from a context instead of a prop: nearly
 * every component renders text, and threading a translator through each prop list would change
 * every signature for no gain in testability. The app provides the value; outside a provider - a
 * unit test, a story, a page without the app - it is English.
 *
 * Each member reads the locale when it is called, so text rendered through it repaints on a
 * language change.
 */
export interface TextValue {
  locale: () => TranslatedLocale;
  t: AppTranslate;
  format: AppFormat;
  /** `userErrorMessage` in the interface language. `fallback` is already translated. */
  errorMessage: (error: unknown, fallback: string) => string;
  /** Text a host or the main process sent as English source text, in the interface language. */
  sourceText: (text: string) => string;
}

// `formatLocale` is `null` outside a provider: numbers and dates then use the runtime's locale.
function createTextValue(locale: () => TranslatedLocale, formatLocale: () => string | null): TextValue {
  const current = () => createFormat(locale(), formatLocale());
  return {
    locale,
    t: (key, ...params) => translateFor(locale())(key, ...params),
    format: {
      get locale() {
        return locale();
      },
      number: (value, options) => current().number(value, options),
      compact: (value) => current().compact(value),
      percent: (value, options) => current().percent(value, options),
      currencyUsd: (value, options) => current().currencyUsd(value, options),
      date: (value, options) => current().date(value, options),
      list: (items) => current().list(items),
      fileSize: (bytes) => current().fileSize(bytes),
    },
    errorMessage: (error, fallback) => userErrorMessage(error, fallback, locale()),
    sourceText: (text) => localizeSourceText(text, locale()),
  };
}

const TextContext = createContext<TextValue>(
  createTextValue(
    () => "en",
    () => null,
  ),
  { name: "Text" },
);

export interface TextProviderProps {
  locale: TranslatedLocale;
  /** The locale of numbers and dates (`formatLocale` from `@openbot/i18n`). The default is `locale`. */
  formatLocale?: string | undefined;
}

// The locale of the last provider that rendered, for code that runs outside a component.
const [activeLocale, setActiveLocale] = createSignal<TranslatedLocale>("en");
const [activeFormatLocale, setActiveFormatLocale] = createSignal<string | null>(null);
const CURRENT_TEXT = createTextValue(activeLocale, activeFormatLocale);

export function TextProvider(props: ParentProps<TextProviderProps>): JSX.Element {
  const formatLocale = () => props.formatLocale ?? props.locale;
  const value = createTextValue(() => props.locale, formatLocale);
  createEffect(
    () => [props.locale, formatLocale()] as const,
    ([locale, format]) => {
      setActiveLocale(locale);
      setActiveFormatLocale(format);
    },
  );
  return <TextContext value={value}>{props.children}</TextContext>;
}

export function useText(): TextValue {
  return useContext(TextContext);
}

/**
 * The text of the app's provider, for a store or an action that runs outside a component. Text it
 * returns is fixed when it is made, so keep it only as long as the message it explains: a component
 * that renders the text itself should call `useText()` instead.
 */
export function currentText(): TextValue {
  return CURRENT_TEXT;
}
