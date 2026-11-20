const PHONE_CANDIDATE = /\+?(?:\(\d{1,5}\)|\d)(?:[ -]?(?:\(\d{1,5}\)|\d))*/uy;
const PHONE_START = /[+(\d]/gu;
const BOUNDARY_BEFORE = /[\p{L}\p{N}_+\-./#@=&?%$€£]/u;
const BOUNDARY_AFTER = /^(?:[\p{L}\p{N}_%°@+]|[-.,:/]\d)/u;
const NORTH_AMERICAN = /^(?:1[ -])?\d{3}[ -]\d{3}[ -]\d{4}$/u;
const NATIONAL = /^0[1-9]\d*[ (-]/u;
const LAST_GROUP = /(\d+)\)?$/u;
const AFTER_LENGTH = 2;
const SCAN_WINDOW = 512;
const WHITESPACE = /\s/gu;

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
  if ((LAST_GROUP.exec(text)?.[1]?.length ?? 0) < 3) return false;
  if (text.startsWith("+")) return digits >= 8 && digits <= 15;
  if (text.startsWith("(")) return digits >= 10 && digits <= 11;
  if (NORTH_AMERICAN.test(text)) return true;
  return NATIONAL.test(text) && digits >= 9 && digits <= 12;
}

function boundaryBefore(before: string | undefined): boolean {
  return !before || !BOUNDARY_BEFORE.test(before);
}

function candidatePrefixes(candidate: string): string[] {
  const prefixes = [candidate];
  for (let end = candidate.length - 1; end > 0; end -= 1) {
    if (candidate[end] === " " || candidate[end] === "-") prefixes.push(candidate.slice(0, end));
  }
  return prefixes;
}

function phoneNumberAt(source: string, index: number, before = source[index - 1]): ChatPhoneNumber | null {
  if (!boundaryBefore(before)) return null;
  PHONE_CANDIDATE.lastIndex = index;
  const candidate = PHONE_CANDIDATE.exec(source)?.[0];
  if (!candidate) return null;
  for (const prefix of candidatePrefixes(candidate.replace(/[ -]+$/u, ""))) {
    const end = index + prefix.length;
    if (BOUNDARY_AFTER.test(source.slice(end, end + AFTER_LENGTH))) continue;
    if (isPhoneNumber(prefix))
      return { text: prefix, href: `tel:${prefix.startsWith("+") ? "+" : ""}${digitsOf(prefix)}` };
  }
  return null;
}

export function phoneNumberAtStart(source: string, before: string): ChatPhoneNumber | null {
  return phoneNumberAt(source, 0, before);
}

function whitespaceFrom(source: string, index: number): number | undefined {
  WHITESPACE.lastIndex = index;
  return WHITESPACE.exec(source)?.index;
}

export function nextPhoneNumberIndex(source: string): number | undefined {
  let scanned = SCAN_WINDOW;
  PHONE_START.lastIndex = 0;
  for (let match = PHONE_START.exec(source); match && match.index < scanned; match = PHONE_START.exec(source)) {
    if (phoneNumberAt(source, match.index)) return match.index;
    PHONE_CANDIDATE.lastIndex = match.index;
    scanned = Math.max(scanned, match.index + (PHONE_CANDIDATE.exec(source)?.[0].length ?? 0));
  }
  return source.length > scanned ? whitespaceFrom(source, scanned) : undefined;
}
