import { formatTranslation } from "./format-catalogs";
import type { TranslatedLocale } from "./locale";
import { createTranslate } from "./message";
import { messages as en } from "./messages/en/format";

/**
 * Numbers, dates, lists and sizes in the interface language.
 *
 * A screen formats through this instead of calling `toLocaleString()` with no locale, which reads
 * the computer's language rather than the one chosen in Settings, or with a fixed `"en-US"`.
 *
 * The mobile app runs on Hermes, which may lack `Intl.ListFormat` and compact number notation (not
 * confirmed on a device). Each such method has a fallback, so a missing API renders a plain form,
 * never an exception.
 */
export interface AppFormat {
  readonly locale: TranslatedLocale;
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
  /** 1.2K, 3.4M. A plain number where compact notation is not available. */
  compact: (value: number) => string;
  /** `value` is a ratio: 0.25 renders 25%. */
  percent: (value: number, options?: Intl.NumberFormatOptions) => string;
  currencyUsd: (value: number, options?: Intl.NumberFormatOptions) => string;
  date: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string;
  /** The date locale writes a 12-hour clock with AM and PM: true for `en-US`, false for `fr` and `ja`. */
  readonly hour12: boolean;
  /** A conjunction: "a, b, and c". */
  list: (items: readonly string[]) => string;
  /** Binary units, as the attachment cards show them: 512 B, 12 KB, 3.4 MB. */
  fileSize: (bytes: number) => string;
  /** `bytes` in the unit that `fileSize` writes `total` in, without the unit: "148.0" of "412.0 MB". */
  fileSizeAmount: (bytes: number, total: number) => string;
}

/** The unit that `fileSize` writes `bytes` in, as a power of 1024: 0 is bytes, 4 is terabytes. */
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

/**
 * A date format is slow to create, mostly on Hermes, and a list writes one date for each row. The
 * time zone offset is part of the key: a format keeps the time zone of the moment it was created.
 */
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

/**
 * Hermes may not give `hourCycle` in the resolved options (not confirmed on a device). Then the
 * text of 13:00 decides: a 24-hour clock writes "13". If `Intl` fails, keep the 12-hour clock that
 * the app showed before.
 */
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

/**
 * `locale` selects the words: file size units, list words and compact suffixes. `intlLocale`
 * selects the conventions of numbers and dates (see `formatLocale`). `null` is the runtime's own
 * locale, for a surface with no language setting.
 */
export function createFormat(locale: TranslatedLocale, intlLocale: string | null = locale): AppFormat {
  const cacheKey = `${locale}\u0000${intlLocale ?? ""}`;
  const cached = formats.get(cacheKey);
  if (cached) return cached;
  const tag = intlLocale ?? undefined;
  const translation = formatTranslation(locale);
  const t = createTranslate({ source: en, translation, locale, sourceLocale: "en" });
  const oneDecimal = (value: number) =>
    numberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }).format(value);
  // Bytes and kilobytes are whole numbers, written with no locale digits, as before.
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
  // A language that is not loaded yet formats with English words, and the next call after the load
  // makes the format again.
  if (translation) formats.set(cacheKey, format);
  return format;
}
