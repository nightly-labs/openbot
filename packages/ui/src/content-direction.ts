const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-ﻼ\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]/u;
const LETTER = /\p{L}/u;

export function textDirection(text: string): "ltr" | "rtl" | undefined {
  const letter = LETTER.exec(text)?.[0];
  if (!letter) return undefined;
  return RTL_LETTER.test(letter) ? "rtl" : "ltr";
}

export function firstTextDirection(texts: Iterable<string>): "ltr" | "rtl" | undefined {
  for (const text of texts) {
    const direction = textDirection(text);
    if (direction) return direction;
  }
  return undefined;
}

export function hasRightToLeftLetter(text: string): boolean {
  for (const character of text) if (LETTER.test(character) && RTL_LETTER.test(character)) return true;
  return false;
}
