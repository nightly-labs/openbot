/**
 * The plural category of a count in a locale.
 *
 * `Intl.PluralRules` is used where the runtime has it. The mobile app runs on Hermes, which may not
 * ship it (not confirmed on a device), so each translated language also has its CLDR rule written
 * out here. A new language adds its rule to `BUILT_IN_RULES`; see docs/i18n.md.
 */

type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

type PluralRule = (count: number) => PluralCategory;

// CLDR: one is the integer 1 with no visible fraction digits.
const english: PluralRule = (count) => (count === 1 ? "one" : "other");

const BUILT_IN_RULES: Readonly<Record<string, PluralRule>> = {
  en: english,
  // CLDR: one is every number from 0 up to, but not including, 2.
  fr: (count) => (count >= 0 && count < 2 ? "one" : "other"),
  // Japanese has one form for every count.
  ja: () => "other",
  // CLDR Portuguese: one for integer parts 0 and 1; many for nonzero multiples of one million.
  pt: (count) => {
    const absolute = Math.abs(count);
    if (absolute < 2) return "one";
    return Number.isInteger(absolute) && absolute % 1_000_000 === 0 ? "many" : "other";
  },
  // CLDR Russian: one for 1, 21, 31…; few for 2–4, 22–24…; many for 0, 5–20, 25–30…; other for fractions.
  ru: (count) => {
    const absolute = Math.abs(count);
    if (!Number.isInteger(absolute)) return "other";
    const lastDigit = absolute % 10;
    const lastTwo = absolute % 100;
    if (lastDigit === 1 && lastTwo !== 11) return "one";
    if (lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14)) return "few";
    return "many";
  },
  // CLDR: one is the integer 1.
  tr: (count) => (count === 1 ? "one" : "other"),
};

const rulesByLocale = new Map<string, Intl.PluralRules>();

function intlRules(locale: string): Intl.PluralRules | undefined {
  if (typeof Intl === "undefined" || typeof Intl.PluralRules !== "function") return undefined;
  const cached = rulesByLocale.get(locale);
  if (cached) return cached;
  // An unknown tag throws rather than falling back, and a bad stored preference must not blank the
  // interface. English rules are wrong for that language but still render a readable sentence.
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
