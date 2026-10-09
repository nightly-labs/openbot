// Hermes may not have Intl.Segmenter. The fallback keeps flags, marks, skin tones and joined emoji whole.
const GRAPHEME_FALLBACK =
  /\p{Regional_Indicator}{2}|\P{M}[\p{M}\p{Emoji_Modifier}]*(?:‍\P{M}[\p{M}\p{Emoji_Modifier}]*)*/gu;

/** The characters a reader sees: a flag, a letter with its accents, or a joined emoji is one. */
export function graphemes(text: string): string[] {
  if (Intl.Segmenter) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
  }
  return text.match(GRAPHEME_FALLBACK) ?? [];
}
