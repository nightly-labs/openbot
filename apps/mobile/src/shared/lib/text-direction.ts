import { I18nManager, Platform, type TextStyle, type ViewStyle } from "react-native";

export type TextDirection = "ltr" | "rtl";

/** No mark, the left-to-right mark, or the right-to-left mark. */
export type DirectionMark = "" | "\u200e" | "\u200f";

/**
 * Text that does not give a paragraph its direction: code, math, link targets, tags, URLs, mentions,
 * task boxes and HTML entities. Their letters are often Latin in a right-to-left paragraph. The
 * expression is sticky: it matches only at the position that the scan is at.
 */
const NEUTRAL_SPAN = new RegExp(
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
  "iuy",
);

/** A letter, or a left-to-right or right-to-left mark: the first of them sets the direction. */
const STRONG = /[\p{L}\u200e\u200f\u061c]/u;

/**
 * Letters of right-to-left scripts (Unicode bidi classes R and AL): Hebrew, Arabic, Syriac, Thaana,
 * NKo, Samaritan, Mandaic and their extensions, the right-to-left presentation forms, and the
 * right-to-left blocks of the supplementary planes.
 */
const RIGHT_TO_LEFT = /[\u0590-\u08ff\u200f\u061c\ufb1d-\ufdff\ufe70-\ufeff\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]/u;

function letterDirection(letter: string): TextDirection {
  return RIGHT_TO_LEFT.test(letter) ? "rtl" : "ltr";
}

/**
 * The base direction of a paragraph, from its first letter, as the Unicode bidi algorithm finds it
 * (rules P2 and P3). Digits, punctuation, Markdown syntax and code do not count. The scan stops at
 * the first letter, so a long draft costs no more than its first words.
 *
 * @param fallback The direction of text with no letter, such as an empty field or a number.
 */
export function textDirection(text: string, fallback: TextDirection = "ltr"): TextDirection {
  let index = 0;
  while (index < text.length) {
    NEUTRAL_SPAN.lastIndex = index;
    const span = NEUTRAL_SPAN.exec(text);
    if (span && span[0].length > 0) {
      index += span[0].length;
      continue;
    }
    const character = String.fromCodePoint(text.codePointAt(index) ?? 0);
    if (STRONG.test(character)) return letterDirection(character);
    index += character.length;
  }
  return fallback;
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
 * An invisible mark that gives Android text the base direction that `textDirection` found, or
 * nothing when Android finds that direction itself. Android text does not read `writingDirection`:
 * it takes the first letter, also one in code or a mention, and the layout direction for text with
 * no letter. iOS text reads `writingDirection`, so there the mark is always empty.
 */
export function directionMark(text: string, direction: TextDirection): DirectionMark {
  if (Platform.OS !== "android") return "";
  const letter = STRONG.exec(text)?.[0];
  const platform = letter ? letterDirection(letter) : layoutDirection();
  if (platform === direction) return "";
  return direction === "rtl" ? "\u200f" : "\u200e";
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
 * The sign of a horizontal transform that moves toward the end of the layout. React Native mirrors
 * the layout in a right-to-left language, but not `translateX` and not `transformOrigin`, so an
 * offset that a left-to-right layout computes is multiplied by this.
 */
export const END_X: 1 | -1 = I18nManager.isRTL ? -1 : 1;

/**
 * The style of an iOS text field that holds `text`, or of an empty one. iOS aligns a field by the
 * language of the phone, not by the layout of the app, so a field sets its side from its text, and
 * an empty field, which shows its placeholder, from the layout. Android aligns its fields itself.
 */
export function fieldDirectionStyle(text: string): TextStyle | undefined {
  if (Platform.OS !== "ios") return undefined;
  // An iOS field does not swap textAlign left and right with the layout direction.
  const direction = textDirection(text, layoutDirection());
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
