import { SPEECH_LIMITS } from "@openbot/contracts/ipc";

/**
 * The first part is short, so the first words play soon after the reply ends. It ends at the first
 * sentence that makes it at least the minimum length.
 */
const FIRST_PART_MINIMUM = 40;
const FIRST_PART_LENGTH = 80;
/**
 * A later part is synthesized while earlier parts play. On a fast computer a part may be at
 * most three times as long as the part before it. On a slower computer, `partBudget` keeps it
 * shorter, so that it is ready before the audio that waits to play ends.
 */
const PART_GROWTH = 3;
const PART_LENGTH = 400;
/** The share of the playing time that the synthesis of the next part may use. The rest is a margin. */
const SYNTHESIS_SHARE = 0.8;

/**
 * The text in parts that `speak` takes, made one part at a time. Parts end at a sentence where they
 * can, and a sentence that is too long for one part ends at a comma or a space. `speed` is the
 * playback speed, where 1 is normal: a part that plays faster leaves less time to synthesize the
 * next part, so the parts grow more slowly. The first part does not change with the speed.
 */
export class SpeechParts {
  readonly #sentences: string[];
  readonly #growth: number;
  #last: string | undefined;

  constructor(text: string, locale: string, speed = 1) {
    const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
    this.#sentences = Array.from(segmenter.segment(text), ({ segment }) => segment.trim()).filter(Boolean);
    this.#growth = PART_GROWTH / Math.max(1, speed);
  }

  /**
   * The next part, or undefined at the end of the text. `budget` is the most characters that the
   * computer can synthesize in time (see `partBudget`). It joins fewer sentences, but it does not cut
   * a sentence: a part always has at least one sentence, or one piece of a long sentence.
   */
  next(budget = Number.POSITIVE_INFINITY): string | undefined {
    const last = this.#last;
    const first = last === undefined;
    const length = first
      ? FIRST_PART_LENGTH
      : Math.min(PART_LENGTH, Math.max(FIRST_PART_LENGTH, Math.floor(last.length * this.#growth)));
    const limit = Math.min(length, budget);
    let part = "";
    for (let sentence = this.#sentences[0]; sentence !== undefined; sentence = this.#sentences[0]) {
      const piece = sentence.length > length ? firstPiece(sentence, length) : sentence;
      if (part && part.length + piece.length + 1 > limit) break;
      part = part ? `${part} ${piece}` : piece;
      const rest = sentence.slice(piece.length).trim();
      if (rest) {
        this.#sentences[0] = rest;
        break;
      }
      this.#sentences.shift();
      if (part.length >= limit || (first && part.length >= FIRST_PART_MINIMUM)) break;
    }
    if (!part) return undefined;
    this.#last = part;
    return part.slice(0, SPEECH_LIMITS.maximumTextLength);
  }
}

/**
 * The most characters of the next part that the computer can synthesize while `seconds` of audio
 * play, from the time that the synthesis of `part` took. `seconds` is at normal speed.
 */
export function partBudget(part: string, seconds: number, synthesisMs: number, speed: number): number {
  if (!part || synthesisMs <= 0) return Number.POSITIVE_INFINITY;
  const playMs = (seconds * 1000) / Math.max(speed, Number.EPSILON);
  return Math.floor((playMs * SYNTHESIS_SHARE * part.length) / synthesisMs);
}

/** The first piece of a sentence that is longer than `limit`: it ends at a comma or a space where it can. */
function firstPiece(sentence: string, limit: number): string {
  const window = sentence.slice(0, limit);
  const comma = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf("、"));
  const space = window.lastIndexOf(" ");
  const cut = comma > limit / 2 ? comma + 1 : space > limit / 2 ? space : limit;
  return sentence.slice(0, cut).trim();
}
