const RTL_LETTER =
  /(?=\p{L})[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/gu;
const LETTER = /\p{L}/gu;
const LINK_TARGET = /https?:\/\/\S+/gu;

/**
 * A right-to-left text often holds Latin product names and can start with one, so its first letter
 * (`dir="auto"`) does not tell the direction. Latin words are also longer, so the share stays low.
 */
const RTL_LETTER_SHARE = 0.3;

/** The direction of a text, from the share of its letters. A text with no letters has none. */
export function textDirection(text: string): "rtl" | "ltr" | undefined {
  const prose = text.replace(LINK_TARGET, "");
  const letters = prose.match(LETTER)?.length ?? 0;
  if (letters === 0) return undefined;
  const rtlLetters = prose.match(RTL_LETTER)?.length ?? 0;
  return rtlLetters / letters >= RTL_LETTER_SHARE ? "rtl" : "ltr";
}
