import { type Accessor, createContext, useContext } from "solid-js";

export interface StreamingRevealChunk {
  length: number;
  revealedAt: number;
}

export const StreamingRevealContext = createContext<Accessor<StreamingRevealChunk[]> | null>(null);

export function useStreamingReveal(): Accessor<StreamingRevealChunk[]> | null {
  return useContext(StreamingRevealContext);
}

const MIN_CHARACTERS_PER_SECOND = 120;
const STREAMING_WORD = /\s*(?:(?:#{1,6}|[-+*>]|\d+[.)])\s+)?\S+\s+/uy;

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
  return { length, budget: Math.max(budget, -minimumStep) };
}

export function streamingTrailReach(trail: readonly StreamingRevealChunk[]): number {
  let reach = 0;
  for (const chunk of trail) reach += chunk.length;
  return reach;
}

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
    while (start < end && /\S/u.test(text.charAt(start - 1)) && /\S/u.test(text.charAt(start))) start += 1;
    if (start >= end) continue;
    chunks.unshift({ text: text.slice(start, end), revealedAt: step.revealedAt });
    end = start;
  }
  return { prefix: text.slice(0, end), chunks };
}
