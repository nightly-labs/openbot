import type { JSX } from "@solidjs/web";
import { createMemo, For, Show } from "solid-js";
import { hasRightToLeftLetter } from "./content-direction";

interface DigitRun {
  readonly text: string;
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
