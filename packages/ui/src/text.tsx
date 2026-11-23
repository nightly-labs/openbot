import { I18nProvider as ControlLocaleProvider } from "@kobalte/core/i18n";
import {
  type AppFormat,
  type AppTranslate,
  createFormat,
  localizeSourceText,
  type TranslatedLocale,
  translateFor,
} from "@openbot/i18n";
import { type UserErrorDetails, userErrorDetails, userErrorMessage } from "@openbot/user-errors";
import type { JSX } from "@solidjs/web";
import { createContext, createEffect, createSignal, type ParentProps, useContext } from "solid-js";

export interface TextValue {
  locale: () => TranslatedLocale;
  t: AppTranslate;
  format: AppFormat;
  errorMessage: (error: unknown, fallback: string) => string;
  errorDetails: (error: unknown, fallback: string) => UserErrorDetails;
  sourceText: (text: string) => string;
}

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
      get hour12() {
        return current().hour12;
      },
      list: (items) => current().list(items),
      fileSize: (bytes) => current().fileSize(bytes),
      fileSizeAmount: (bytes, total) => current().fileSizeAmount(bytes, total),
      diskSize: (bytes) => current().diskSize(bytes),
    },
    errorMessage: (error, fallback) => userErrorMessage(error, fallback, locale()),
    errorDetails: (error, fallback) => userErrorDetails(error, fallback, locale()),
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
  formatLocale?: string | undefined;
}

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
  const controlLocale = () => {
    const format = formatLocale();
    return format.split("-")[0]?.toLowerCase() === props.locale ? format : props.locale;
  };
  return (
    <TextContext value={value}>
      <ControlLocaleProvider locale={controlLocale()}>{props.children}</ControlLocaleProvider>
    </TextContext>
  );
}

export function useText(): TextValue {
  return useContext(TextContext);
}

export function currentText(): TextValue {
  return CURRENT_TEXT;
}
