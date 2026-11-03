/** A letter of a right-to-left script: Hebrew, Arabic, Syriac, Thaana, N'Ko and their presentation forms. */
const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-ﻼ\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]/u;
const LETTER = /\p{L}/u;

/**
 * The base direction of user text from its first letter, as `dir="auto"` finds it. Use it for an
 * element that holds blocks with their own `dir`, such as a list or a table: `dir="auto"` skips
 * those descendants. Undefined, for text with no letter, keeps the inherited direction.
 */
export function textDirection(text: string): "ltr" | "rtl" | undefined {
  const letter = LETTER.exec(text)?.[0];
  if (!letter) return undefined;
  return RTL_LETTER.test(letter) ? "rtl" : "ltr";
}
