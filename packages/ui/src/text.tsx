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
import { createContext, type ParentProps, useContext } from "solid-js";

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

function createTextValue(locale: () => TranslatedLocale): TextValue {
  const current = () => createFormat(locale());
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
  createTextValue(() => "en"),
  { name: "Text" },
);

export interface TextProviderProps {
  locale: TranslatedLocale;
}

export function TextProvider(props: ParentProps<TextProviderProps>): JSX.Element {
  const value = createTextValue(() => props.locale);
  return <TextContext value={value}>{props.children}</TextContext>;
}

export function useText(): TextValue {
  return useContext(TextContext);
}
