const GRAPHEME_FALLBACK =
  /\p{Regional_Indicator}{2}|\P{M}[\p{M}\p{Emoji_Modifier}]*(?:‍\P{M}[\p{M}\p{Emoji_Modifier}]*)*/gu;

export function graphemes(text: string): string[] {
  if (Intl.Segmenter) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
  }
  return text.match(GRAPHEME_FALLBACK) ?? [];
}
