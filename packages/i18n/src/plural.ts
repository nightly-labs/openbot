type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

type PluralRule = (count: number) => PluralCategory;

const english: PluralRule = (count) => (count === 1 ? "one" : "other");

const BUILT_IN_RULES: Readonly<Record<string, PluralRule>> = {
  en: english,
  ar: (count) => {
    const absolute = Math.abs(count);
    if (!Number.isInteger(absolute)) return "other";
    if (absolute === 0) return "zero";
    if (absolute === 1) return "one";
    if (absolute === 2) return "two";
    const lastTwo = absolute % 100;
    if (lastTwo >= 3 && lastTwo <= 10) return "few";
    if (lastTwo >= 11) return "many";
    return "other";
  },
  de: (count) => (Math.abs(count) === 1 ? "one" : "other"),
  es: (count) => {
    const absolute = Math.abs(count);
    if (absolute === 1) return "one";
    return absolute !== 0 && Number.isInteger(absolute) && absolute % 1_000_000 === 0 ? "many" : "other";
  },
  fr: (count) => (count >= 0 && count < 2 ? "one" : "other"),
  he: (count) => {
    const absolute = Math.abs(count);
    if (absolute === 1 || (absolute > 0 && absolute < 1)) return "one";
    return absolute === 2 ? "two" : "other";
  },
  it: (count) => {
    const absolute = Math.abs(count);
    if (absolute === 1) return "one";
    return absolute !== 0 && Number.isInteger(absolute) && absolute % 1_000_000 === 0 ? "many" : "other";
  },
  ja: () => "other",
  ko: () => "other",
  nl: (count) => (Math.abs(count) === 1 ? "one" : "other"),
  pl: (count) => {
    const absolute = Math.abs(count);
    if (!Number.isInteger(absolute)) return "other";
    if (absolute === 1) return "one";
    const lastDigit = absolute % 10;
    const lastTwo = absolute % 100;
    if (lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14)) return "few";
    return "many";
  },
  pt: (count) => {
    const absolute = Math.abs(count);
    if (absolute < 2) return "one";
    return Number.isInteger(absolute) && absolute % 1_000_000 === 0 ? "many" : "other";
  },
  ru: (count) => {
    const absolute = Math.abs(count);
    if (!Number.isInteger(absolute)) return "other";
    const lastDigit = absolute % 10;
    const lastTwo = absolute % 100;
    if (lastDigit === 1 && lastTwo !== 11) return "one";
    if (lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14)) return "few";
    return "many";
  },
  tr: (count) => (count === 1 ? "one" : "other"),
  zh: () => "other",
};

const rulesByLocale = new Map<string, Intl.PluralRules>();

function intlRules(locale: string): Intl.PluralRules | undefined {
  if (typeof Intl === "undefined" || typeof Intl.PluralRules !== "function") return undefined;
  const cached = rulesByLocale.get(locale);
  if (cached) return cached;
  let rules: Intl.PluralRules;
  try {
    rules = new Intl.PluralRules(locale);
  } catch {
    rules = new Intl.PluralRules("en");
  }
  rulesByLocale.set(locale, rules);
  return rules;
}

export function pluralCategory(locale: string, count: number): PluralCategory {
  const rules = intlRules(locale);
  if (rules) return rules.select(count);
  const language = locale.split("-")[0]?.toLowerCase() ?? "";
  return (BUILT_IN_RULES[language] ?? english)(count);
}
