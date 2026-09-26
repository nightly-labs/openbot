import { type Accessor, createContext, useContext } from "solid-js";

/** One step of revealed text: how many characters of the body it showed, and when. */
export interface StreamingRevealChunk {
  length: number;
  revealedAt: number;
}

/**
 * The recent reveal steps of the streaming message, oldest first. The text tail reads them to
 * fade each step on its own, so a step that is still fading does not jump to full opacity when
 * the next one appears.
 */
export const StreamingRevealContext = createContext<Accessor<StreamingRevealChunk[]> | null>(null);

export function useStreamingReveal(): Accessor<StreamingRevealChunk[]> | null {
  return useContext(StreamingRevealContext);
}

/** The slowest reveal speed, so the last few words of a backlog do not crawl. */
const MIN_CHARACTERS_PER_SECOND = 120;
const STREAMING_WORD = /\s*(?:(?:#{1,6}|[-+*>]|\d+[.)])\s+)?\S+\s+/uy;

/**
 * How far one reveal step advances, and the budget it leaves for the next step.
 *
 * The budget grows with the backlog, so the text shown stays about `catchUpMs` behind the text
 * received however fast the model writes, and a whole reply that arrives at once shows in about
 * that time too. Steps end on a word boundary. While the reply streams, a last word with no
 * space after it can still grow, so it waits.
 */
export function nextStreamingReveal(input: {
  shownLength: number;
  target: string;
  streaming: boolean;
  budget: number;
  stepMs: number;
  catchUpMs: number;
}): { length: number; budget: number } {
  const { target, stepMs } = input;
  const backlog = target.length - input.shownLength;
  if (backlog <= 0) return { length: target.length, budget: 0 };
  const minimumStep = (MIN_CHARACTERS_PER_SECOND * stepMs) / 1000;
  let budget = input.budget + (backlog * stepMs) / Math.max(input.catchUpMs, stepMs) + minimumStep;
  let length = input.shownLength;
  while (budget > 0) {
    STREAMING_WORD.lastIndex = length;
    const word = STREAMING_WORD.exec(target);
    if (!word) {
      if (input.streaming) return { length, budget: Math.min(budget, 0) };
      return { length: target.length, budget: 0 };
    }
    length += word[0].length;
    budget -= word[0].length;
  }
  // A long word, such as a URL, overshoots the budget. Owe only what the next step always adds,
  // so the text after it does not stop while a small backlog repays the debt.
  return { length, budget: Math.max(budget, -minimumStep) };
}

/** How many characters of the body the fading steps cover. */
export function streamingTrailReach(trail: readonly StreamingRevealChunk[]): number {
  let reach = 0;
  for (const chunk of trail) reach += chunk.length;
  return reach;
}

/**
 * The characters of the body after each sibling, from their source lengths and the characters
 * after the last one. A sibling with more text after it than the trail covers gets `undefined`
 * and shows its text with no fade. An unknown source length, such as a chip, is `Infinity`: the
 * siblings before it then do not fade, because too small an offset would fade shown words again.
 */
export function streamingTailOffsets(
  lengths: readonly number[],
  after: number | undefined,
  reach: number,
): (number | undefined)[] {
  const offsets: (number | undefined)[] = lengths.map(() => undefined);
  if (after === undefined) return offsets;
  let rest = after;
  for (let index = lengths.length - 1; index >= 0 && rest < reach; index -= 1) {
    offsets[index] = rest;
    rest += lengths[index] ?? Number.POSITIVE_INFINITY;
  }
  return offsets;
}

/**
 * The characters after the children of a node, from the characters after the node. The closing
 * markup of the node, such as `**` or `](url)`, comes between them.
 */
export function streamingTailInside(
  raw: string,
  children: readonly { raw: string }[],
  after: number | undefined,
): number | undefined {
  if (after === undefined) return undefined;
  const inner = children.map((child) => child.raw).join("");
  const start = raw.indexOf(inner);
  return start < 0 ? after : after + raw.length - start - inner.length;
}

export function sameStreamingTailOffsets(
  previous: readonly (number | undefined)[],
  next: readonly (number | undefined)[],
): boolean {
  return previous.length === next.length && previous.every((offset, index) => offset === next[index]);
}

/**
 * Split the end of rendered text into the reveal steps that are still fading. `after` is the
 * number of body characters that come after this text; the newest steps cover those first.
 *
 * The steps count characters of the Markdown source, and the rendered text has lost its markup,
 * so near a marker a fading step can cover a few words more or less.
 */
export function splitStreamingTrail(
  text: string,
  trail: readonly StreamingRevealChunk[],
  after = 0,
): { prefix: string; chunks: { text: string; revealedAt: number }[] } {
  const chunks: { text: string; revealedAt: number }[] = [];
  let end = text.length;
  let skip = after;
  for (let index = trail.length - 1; index >= 0 && end > 0; index -= 1) {
    const step = trail[index];
    if (!step) continue;
    if (skip >= step.length) {
      skip -= step.length;
      continue;
    }
    let start = Math.max(0, end - step.length + skip);
    skip = 0;
    /* Keep a word in one step, so its halves do not fade at different speeds. Steps end on word
       boundaries, so a start inside a word comes from markup that the text does not show, such as
       a hidden `**`. That step then reaches too far back: give the word to the older step, so a
       word that is already shown does not fade again. */
    while (start < end && /\S/u.test(text.charAt(start - 1)) && /\S/u.test(text.charAt(start))) start += 1;
    if (start >= end) continue;
    chunks.unshift({ text: text.slice(start, end), revealedAt: step.revealedAt });
    end = start;
  }
  return { prefix: text.slice(0, end), chunks };
}
