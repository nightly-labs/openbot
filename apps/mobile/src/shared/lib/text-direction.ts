import { I18nManager, Platform, type TextStyle, type ViewStyle } from "react-native";

export type TextDirection = "ltr" | "rtl";

export type DirectionMark = "" | "\u200e" | "\u200f";

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

const STRONG = /[\p{L}\u200e\u200f\u061c]/u;

const RIGHT_TO_LEFT = /[\u0590-\u08ff\u200f\u061c\ufb1d-\ufdff\ufe70-\ufeff\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]/u;

function letterDirection(letter: string): TextDirection {
  return RIGHT_TO_LEFT.test(letter) ? "rtl" : "ltr";
}

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

export function layoutDirection(): TextDirection {
  return I18nManager.isRTL ? "rtl" : "ltr";
}

export function textDirectionStyle(direction: TextDirection, layout: TextDirection = layoutDirection()): TextStyle {
  return { writingDirection: direction, textAlign: direction === layout ? "left" : "right" };
}

export function directionMark(text: string, direction: TextDirection): DirectionMark {
  if (Platform.OS !== "android") return "";
  const letter = STRONG.exec(text)?.[0];
  const platform = letter ? letterDirection(letter) : layoutDirection();
  if (platform === direction) return "";
  return direction === "rtl" ? "\u200f" : "\u200e";
}

export function lineDirectionStyle(text: string): TextStyle {
  return { writingDirection: textDirection(text), textAlign: "left" };
}

export const END_X: 1 | -1 = I18nManager.isRTL ? -1 : 1;

export function fieldDirectionStyle(text: string): TextStyle | undefined {
  if (Platform.OS !== "ios") return undefined;
  const direction = textDirection(text, layoutDirection());
  return { writingDirection: direction, textAlign: direction === "rtl" ? "right" : "left" };
}

export const CODE_LAYOUT_STYLE: ViewStyle = { direction: "ltr" };
export const CODE_TEXT_STYLE: TextStyle = { writingDirection: "ltr", textAlign: "left" };

export const MIRROR_IN_RTL: ViewStyle | undefined = I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined;
