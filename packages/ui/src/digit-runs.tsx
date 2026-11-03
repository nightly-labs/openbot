import type { JSX } from "@solidjs/web";
import { createMemo, For, Show } from "solid-js";
import { hasRightToLeftLetter } from "./content-direction";

interface DigitRun {
  /** Digits and the separators between them, or the words and spaces around them. */
  readonly text: string;
  /** The position of the first character in the formatted value. */
  readonly start: number;
  readonly number: boolean;
}

const NUMBER = /\p{Nd}(?:[\p{Nd}.,\p{Zs}٫٬]*\p{Nd})?/gu;

function digitRuns(text: string): { runs: DigitRun[]; rightToLeft: boolean } {
  const runs: DigitRun[] = [];
  let end = 0;
  for (const match of text.matchAll(NUMBER)) {
    if (match.index > end) runs.push({ text: text.slice(end, match.index), start: end, number: false });
    runs.push({ text: match[0], start: match.index, number: true });
    end = match.index + match[0].length;
  }
  if (end < text.length) runs.push({ text: text.slice(end), start: end, number: false });
  const rightToLeft = hasRightToLeftLetter(text);
  return { runs: rightToLeft ? runs.reverse() : runs, rightToLeft };
}

/**
 * The characters of a formatted value in a `t-digit-group`. Each digit is a box of its own, so that
 * it can roll, and the text direction algorithm does not order boxes: in a right-to-left page they
 * came out in reverse, "US$0.004" as "$SU 400.0". The group lays its runs out left to right, in the
 * order they show in. A number keeps its digits left to right; a value with right-to-left words,
 * such as "7.6 ث", puts its runs in reverse, so it reads from the right. A word stays in one piece,
 * so that its letters join.
 *
 * `digit` renders each character of a number, with its position in `text`. `word` renders a word
 * run; without it, the words stay still.
 */
export function DigitRuns(props: {
  text: string;
  digit: (character: () => string, index: () => number) => JSX.Element;
  word?: (text: () => string, index: () => number) => JSX.Element;
}) {
  const split = createMemo(() => digitRuns(props.text));
  return (
    <For each={split().runs} keyed={false}>
      {(run) => (
        <Show
          when={run().number}
          fallback={
            <span class="t-digit-word" dir={split().rightToLeft ? "rtl" : undefined}>
              {props.word
                ? props.word(
                    () => run().text,
                    () => run().start,
                  )
                : run().text}
            </span>
          }
        >
          <span class="t-digit-run">
            <For each={[...run().text]} keyed={false}>
              {(character, index) => props.digit(character, () => run().start + index)}
            </For>
          </span>
        </Show>
      )}
    </For>
  );
}
