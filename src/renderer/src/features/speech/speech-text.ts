import { SPEECH_LIMITS } from "@openbot/contracts/ipc";

const FIRST_PART_MINIMUM = 40;
const FIRST_PART_LENGTH = 80;
const PART_GROWTH = 3;
const PART_LENGTH = 400;
const SYNTHESIS_SHARE = 0.8;

export class SpeechParts {
  readonly #sentences: string[];
  readonly #growth: number;
  #last: string | undefined;

  constructor(text: string, locale: string | undefined, speed = 1) {
    const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
    this.#sentences = Array.from(segmenter.segment(text), ({ segment }) => segment.trim()).filter(Boolean);
    this.#growth = PART_GROWTH / Math.max(1, speed);
  }

  next(budget = Number.POSITIVE_INFINITY): string | undefined {
    const last = this.#last;
    const first = last === undefined;
    const length = first
      ? FIRST_PART_LENGTH
      : Math.min(PART_LENGTH, Math.max(FIRST_PART_LENGTH, Math.floor(last.length * this.#growth)));
    const limit = Math.min(length, Math.max(budget, FIRST_PART_LENGTH));
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

export function partBudget(part: string, seconds: number, synthesisMs: number, speed: number): number {
  if (!part || synthesisMs <= 0) return Number.POSITIVE_INFINITY;
  const playMs = (seconds * 1000) / Math.max(speed, Number.EPSILON);
  return Math.floor((playMs * SYNTHESIS_SHARE * part.length) / synthesisMs);
}

function firstPiece(sentence: string, limit: number): string {
  const window = sentence.slice(0, limit);
  const comma = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf("、"));
  const space = window.lastIndexOf(" ");
  const cut = comma > limit / 2 ? comma + 1 : space > limit / 2 ? space : limit;
  return sentence.slice(0, cut).trim();
}
