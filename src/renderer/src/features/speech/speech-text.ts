import { SPEECH_LIMITS } from "@openbot/contracts/ipc";

/**
 * The first part is short, so the first words play soon after the reply ends. It ends at the first
 * sentence that makes it at least the minimum length.
 */
const FIRST_PART_MINIMUM = 40;
const FIRST_PART_LENGTH = 80;
/**
 * A later part is synthesized while the part before it plays. Synthesis runs about six times faster
 * than speech, so a part may be at most three times as long as the part before it.
 */
const PART_GROWTH = 3;
const PART_LENGTH = 400;

/**
 * The text in parts that `speak` takes. Parts end at a sentence where they can, and a sentence that
 * is too long for one part ends at a comma or a space.
 */
export function speechParts(text: string, locale: string): string[] {
  const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
  const parts: string[] = [];
  let current = "";
  const limit = () => {
    const last = parts.at(-1);
    if (last === undefined) return FIRST_PART_LENGTH;
    return Math.min(PART_LENGTH, Math.max(FIRST_PART_LENGTH, last.length * PART_GROWTH));
  };
  const flush = () => {
    if (current.trim()) parts.push(current.trim());
    current = "";
  };
  for (const { segment } of segmenter.segment(text)) {
    for (const piece of splitLongSentence(segment.trim(), limit())) {
      if (current && current.length + piece.length + 1 > limit()) flush();
      current = current ? `${current} ${piece}` : piece;
      if (current.length >= limit()) flush();
    }
    if (parts.length === 0 && current.length >= FIRST_PART_MINIMUM) flush();
  }
  flush();
  return parts.map((part) => part.slice(0, SPEECH_LIMITS.maximumTextLength));
}

function splitLongSentence(sentence: string, limit: number): string[] {
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const comma = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf("、"));
    const space = window.lastIndexOf(" ");
    const cut = comma > limit / 2 ? comma + 1 : space > limit / 2 ? space : limit;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}
