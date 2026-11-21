import { formatTranslation } from "./format-catalogs";
import type { TranslatedLocale } from "./locale";
import { createTranslate } from "./message";
import { messages as en } from "./messages/en/format";

export interface AppFormat {
  readonly locale: TranslatedLocale;
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
  compact: (value: number) => string;
  percent: (value: number, options?: Intl.NumberFormatOptions) => string;
  currencyUsd: (value: number, options?: Intl.NumberFormatOptions) => string;
  date: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string;
  readonly hour12: boolean;
  list: (items: readonly string[]) => string;
  fileSize: (bytes: number) => string;
  fileSizeAmount: (bytes: number, total: number) => string;
}

function fileSizeExponent(bytes: number): number {
  let exponent = 0;
  while (exponent < 4 && bytes >= 1024 ** (exponent + 1)) exponent += 1;
  return exponent;
}

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string | undefined, options: Intl.NumberFormatOptions | undefined): Intl.NumberFormat {
  const cacheKey = `${locale ?? ""}\u0000${JSON.stringify(options ?? {})}`;
  const cached = numberFormats.get(cacheKey);
  if (cached) return cached;
  const created = new Intl.NumberFormat(locale, options);
  numberFormats.set(cacheKey, created);
  return created;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(locale: string | undefined, options: Intl.DateTimeFormatOptions | undefined): Intl.DateTimeFormat {
  const cacheKey = `${locale ?? ""}\u0000${new Date().getTimezoneOffset()}\u0000${JSON.stringify(options ?? {})}`;
  const cached = dateFormats.get(cacheKey);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(locale, options);
  dateFormats.set(cacheKey, created);
  return created;
}

function compactNumber(locale: string | undefined, value: number): string {
  try {
    return numberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
  } catch {
    return numberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  }
}

function usesHour12(locale: string | undefined): boolean {
  try {
    const formatter = new Intl.DateTimeFormat(locale, { hour: "numeric", timeZone: "UTC" });
    const { hourCycle, hour12 } = formatter.resolvedOptions();
    if (hourCycle) return hourCycle === "h11" || hourCycle === "h12";
    if (typeof hour12 === "boolean") return hour12;
    return !formatter.format(Date.UTC(2024, 0, 1, 13)).includes("13");
  } catch {
    return true;
  }
}

const formats = new Map<string, AppFormat>();

export function createFormat(locale: TranslatedLocale, intlLocale: string | null = locale): AppFormat {
  const cacheKey = `${locale}\u0000${intlLocale ?? ""}`;
  const cached = formats.get(cacheKey);
  if (cached) return cached;
  const tag = intlLocale ?? undefined;
  const translation = formatTranslation(locale);
  const t = createTranslate({ source: en, translation, locale, sourceLocale: "en" });
  const oneDecimal = (value: number) =>
    numberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }).format(value);
  const fileSizeAmount = (bytes: number, exponent: number) => {
    if (exponent === 0) return String(bytes);
    if (exponent === 1) return String(Math.round(bytes / 1024));
    return oneDecimal(bytes / 1024 ** exponent);
  };

  const format: AppFormat = {
    locale,
    number: (value, options) => numberFormat(tag, options).format(value),
    compact: (value) => compactNumber(locale, value),
    percent: (value, options) => numberFormat(tag, { style: "percent", ...options }).format(value),
    currencyUsd: (value, options) =>
      numberFormat(tag, { style: "currency", currency: "USD", ...options }).format(value),
    date: (value, options) => dateFormat(tag, options).format(value),
    hour12: usesHour12(tag),
    list: (items) => {
      if (typeof Intl.ListFormat === "function") {
        return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
      }
      const [first, second] = items;
      if (first === undefined) return "";
      if (second === undefined) return first;
      if (items.length === 2) return t("format.list.pair", { first, second });
      const last = items.at(-1) ?? "";
      return t("format.list.last", { items: items.slice(0, -1).join(t("format.list.separator")), last });
    },
    fileSize: (bytes) => {
      const exponent = fileSizeExponent(bytes);
      const size = fileSizeAmount(bytes, exponent);
      if (exponent === 0) return t("format.fileSize.bytes", { size });
      if (exponent === 1) return t("format.fileSize.kilobytes", { size });
      if (exponent === 2) return t("format.fileSize.megabytes", { size });
      if (exponent === 3) return t("format.fileSize.gigabytes", { size });
      return t("format.fileSize.terabytes", { size });
    },
    fileSizeAmount: (bytes, total) => fileSizeAmount(bytes, fileSizeExponent(total)),
  };
  if (translation) formats.set(cacheKey, format);
  return format;
}
