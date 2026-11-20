const PHONE_PATTERN = String.raw`\+?(?:\(\d{1,5}\)|\d)(?:[ -]?(?:\(\d{1,5}\)|\d))*`;
const PHONE_CANDIDATES = new RegExp(PHONE_PATTERN, "gu");
const PHONE_AT_START = new RegExp(`^${PHONE_PATTERN}`, "u");
const BOUNDARY_BEFORE = /[\p{L}\p{N}_+\-./:#@=&?%$€£]$/u;
const BOUNDARY_AFTER = /^(?:[\p{L}\p{N}_%°]|[-.,:/]\d)/u;
const NORTH_AMERICAN = /^\d{3}-\d{3}-\d{4}$/u;

export interface ChatPhoneNumber {
  text: string;
  href: string;
}

function digitsOf(text: string): string {
  return text.replace(/\D/gu, "");
}

function balancedParentheses(text: string): boolean {
  let depth = 0;
  for (const character of text) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0 || depth > 1) return false;
  }
  return depth === 0;
}

function isPhoneNumber(text: string): boolean {
  const digits = digitsOf(text).length;
  if (!balancedParentheses(text)) return false;
  if (text.startsWith("+")) return digits >= 8 && digits <= 15;
  if (text.startsWith("(")) return digits >= 10 && digits <= 11;
  if (NORTH_AMERICAN.test(text)) return true;
  return /^0[1-9]/u.test(text) && digits >= 9 && digits <= 12;
}

function phoneNumberFrom(source: string, index: number, candidate: string): ChatPhoneNumber | null {
  const text = candidate.replace(/[ -]+$/u, "");
  if (BOUNDARY_AFTER.test(source.slice(index + text.length))) return null;
  if (!isPhoneNumber(text)) return null;
  return { text, href: `tel:${text.startsWith("+") ? "+" : ""}${digitsOf(text)}` };
}

export function phoneNumberAtStart(source: string, before: string): ChatPhoneNumber | null {
  if (BOUNDARY_BEFORE.test(before)) return null;
  const candidate = PHONE_AT_START.exec(source)?.[0];
  return candidate ? phoneNumberFrom(source, 0, candidate) : null;
}

export function nextPhoneNumberIndex(source: string): number | undefined {
  for (const match of source.matchAll(PHONE_CANDIDATES)) {
    if (BOUNDARY_BEFORE.test(source.slice(Math.max(0, match.index - 1), match.index))) continue;
    if (phoneNumberFrom(source, match.index, match[0])) return match.index;
  }
  return undefined;
}
