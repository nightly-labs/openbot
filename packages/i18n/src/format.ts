import type { TranslatedLocale } from "./locale";
import { createTranslate } from "./message";
import { messages as en } from "./messages/en/format";
import { messages as fr } from "./messages/fr/format";
import { messages as ja } from "./messages/ja/format";

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
  /** A conjunction: "a, b, and c". */
  list: (items: readonly string[]) => string;
  /** Binary units, as the attachment cards show them: 512 B, 12 KB, 3.4 MB. */
  fileSize: (bytes: number) => string;
}

const catalogs = { en, fr, ja } as const;

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string | undefined, options: Intl.NumberFormatOptions | undefined): Intl.NumberFormat {
  const cacheKey = `${locale ?? ""}\u0000${JSON.stringify(options ?? {})}`;
  const cached = numberFormats.get(cacheKey);
  if (cached) return cached;
  const created = new Intl.NumberFormat(locale, options);
  numberFormats.set(cacheKey, created);
  return created;
}

function compactNumber(locale: string | undefined, value: number): string {
  try {
    return numberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
  } catch {
    return numberFormat(locale, { maximumFractionDigits: 0 }).format(value);
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
  const t = createTranslate({ source: en, translation: catalogs[locale], locale, sourceLocale: "en" });
  const oneDecimal = (value: number) =>
    numberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }).format(value);

  const format: AppFormat = {
    locale,
    number: (value, options) => numberFormat(tag, options).format(value),
    compact: (value) => compactNumber(locale, value),
    percent: (value, options) => numberFormat(tag, { style: "percent", ...options }).format(value),
    currencyUsd: (value, options) =>
      numberFormat(tag, { style: "currency", currency: "USD", ...options }).format(value),
    date: (value, options) => new Intl.DateTimeFormat(tag, options).format(value),
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
      if (bytes < 1024) return t("format.fileSize.bytes", { size: String(bytes) });
      if (bytes < 1024 ** 2) return t("format.fileSize.kilobytes", { size: String(Math.round(bytes / 1024)) });
      if (bytes < 1024 ** 3) return t("format.fileSize.megabytes", { size: oneDecimal(bytes / 1024 ** 2) });
      if (bytes < 1024 ** 4) return t("format.fileSize.gigabytes", { size: oneDecimal(bytes / 1024 ** 3) });
      return t("format.fileSize.terabytes", { size: oneDecimal(bytes / 1024 ** 4) });
    },
  };
  formats.set(cacheKey, format);
  return format;
}
