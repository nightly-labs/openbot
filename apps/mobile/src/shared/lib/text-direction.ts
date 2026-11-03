import { I18nManager, type TextStyle, type ViewStyle } from "react-native";

export type TextDirection = "ltr" | "rtl";

/**
 * Text that does not give a paragraph its direction: code, math, link targets, tags, URLs, mentions,
 * task boxes and HTML entities. Their letters are often Latin in a right-to-left paragraph.
 */
const NEUTRAL_SPANS = new RegExp(
  [
    "```[\\s\\S]*?(?:```|$)",
    "~~~[\\s\\S]*?(?:~~~|$)",
    "`[^`\\n]*`?",
    "\\$\\$[\\s\\S]*?(?:\\$\\$|$)",
    "\\$[^$\\n]+\\$",
    "\\]\\([^)\\n]*\\)",
    "<[^>\\n]*>",
    "[a-z][a-z\\d+.-]*:\\/\\/\\S*",
    "@\\[[^\\]\\n]*\\]\\([^)\\n]*\\)",
    "@\\S+",
    "\\[[ xX]\\]",
    "&[a-z\\d#]+;",
  ].join("|"),
  "giu",
);

/** A letter, or a left-to-right or right-to-left mark: the first of them sets the direction. */
const STRONG = /[\p{L}\u200e\u200f\u061c]/u;

/**
 * Letters of right-to-left scripts (Unicode bidi classes R and AL): Hebrew, Arabic, Syriac, Thaana,
 * NKo, Samaritan, Mandaic and their extensions, the right-to-left presentation forms, and the
 * right-to-left blocks of the supplementary planes.
 */
const RIGHT_TO_LEFT = /[\u0590-\u08ff\u200f\u061c\ufb1d-\ufdff\ufe70-\ufeff\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]/u;

/**
 * The base direction of a paragraph, from its first letter, as the Unicode bidi algorithm finds it
 * (rules P2 and P3). Digits, punctuation, Markdown syntax and code do not count.
 *
 * @param fallback The direction of text with no letter, such as an empty field or a number.
 */
export function textDirection(text: string, fallback: TextDirection = "ltr"): TextDirection {
  const letter = STRONG.exec(text.replace(NEUTRAL_SPANS, " "))?.[0];
  if (!letter) return fallback;
  return RIGHT_TO_LEFT.test(letter) ? "rtl" : "ltr";
}

/** The direction of the app layout. React Native reads it once at startup. */
export function layoutDirection(): TextDirection {
  return I18nManager.isRTL ? "rtl" : "ltr";
}

/**
 * The style of a React Native `Text` whose content has its own direction. `textAlign` left and right
 * are relative to the layout direction of the text view on iOS and Android: in a right-to-left
 * layout, "left" aligns to the right. `writingDirection` sets the base direction on iOS; Android
 * finds it from the content.
 *
 * @param layout The layout direction of the view that holds the text.
 */
export function textDirectionStyle(direction: TextDirection, layout: TextDirection = layoutDirection()): TextStyle {
  return { writingDirection: direction, textAlign: direction === layout ? "left" : "right" };
}

/**
 * The style of one line in a row, such as a chat preview. The line reads in the direction of its
 * text, so its punctuation and its ellipsis are at the correct end, but it keeps the alignment of
 * the row.
 */
export function lineDirectionStyle(text: string): TextStyle {
  return { writingDirection: textDirection(text), textAlign: "left" };
}

/**
 * The style of an iOS text field or native text view, where `textAlign` left and right do not change
 * with the layout direction.
 */
export function physicalTextDirectionStyle(direction: TextDirection): TextStyle {
  return { writingDirection: direction, textAlign: direction === "rtl" ? "right" : "left" };
}

/** Code is left to right in every language and in every layout. */
export const CODE_LAYOUT_STYLE: ViewStyle = { direction: "ltr" };
export const CODE_TEXT_STYLE: TextStyle = { writingDirection: "ltr", textAlign: "left" };

/**
 * Turns an icon that points in the reading direction, such as a back arrow or a disclosure chevron,
 * to the other side in a right-to-left layout. Do not use it on a clock, a check mark, a logo or a
 * media control.
 */
export const MIRROR_IN_RTL: ViewStyle | undefined = I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined;
