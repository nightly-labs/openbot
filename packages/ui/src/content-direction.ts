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

/** The direction of the first of `texts` that has a letter, such as the cells of a table in reading order. */
export function firstTextDirection(texts: Iterable<string>): "ltr" | "rtl" | undefined {
  for (const text of texts) {
    const direction = textDirection(text);
    if (direction) return direction;
  }
  return undefined;
}

/**
 * The direction of one line of user text. A line that opens with a Latin word but has more
 * right-to-left words is right to left, as "OpenBot روی ویندوز نصب شد" is Persian. Otherwise it is
 * the direction of the first letter, so a line that starts right to left stays so.
 */
function lineDirection(line: string): "ltr" | "rtl" | undefined {
  const first = textDirection(line);
  if (first !== "ltr" || !hasRightToLeftLetter(line)) return first;
  let rightToLeftLead = 0;
  for (const word of line.split(/\s+/u)) {
    const direction = textDirection(word);
    if (direction === "rtl") rightToLeftLead += 1;
    else if (direction === "ltr") rightToLeftLead -= 1;
  }
  return rightToLeftLead > 0 ? "rtl" : "ltr";
}

/**
 * The `dir` for a block whose lines otherwise take the direction of their first letter
 * (`unicode-bidi: plaintext`), or undefined to keep that. It is set only when a line opens with a
 * Latin word but reads right to left, and all lines of the block read in the same direction, so
 * no line takes a direction that its words do not give it.
 */
export function blockDirectionOverride(text: string): "ltr" | "rtl" | undefined {
  let direction: "ltr" | "rtl" | undefined;
  let differs = false;
  for (const line of text.split("\n")) {
    const own = lineDirection(line);
    if (!own) continue;
    if (direction && own !== direction) return undefined;
    direction = own;
    if (own !== textDirection(line)) differs = true;
  }
  return differs ? direction : undefined;
}

/** The text has a letter of a right-to-left script. Arabic-Indic digits are not letters. */
export function hasRightToLeftLetter(text: string): boolean {
  for (const character of text) if (LETTER.test(character) && RTL_LETTER.test(character)) return true;
  return false;
}
