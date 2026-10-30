import { createMemo, For, untrack } from "solid-js";
import { createDigitRoll } from "./digit-roll";
import { prefersReducedMotion } from "./utils";

/**
 * The price, with digits that roll to each new value, as in the task list. They fall when the
 * price goes down and rise when it goes up. Assistive technology reads the plain text.
 */
export function RollingPrice(props: { value: number; format: (value: number) => string; class?: string }) {
  const roll = createDigitRoll(() => props.value, { settleMs: 0, animate: () => !prefersReducedMotion() });
  let previous = untrack(roll.displayed);
  const direction = createMemo(() => {
    const next = roll.displayed();
    const result = next < previous ? -1 : 1;
    previous = next;
    return result;
  });
  // The digits follow the displayed value, so that the new digits do not show before the roll starts.
  const characters = () => props.format(roll.displayed()).split("");
  // The last two digits trail the others, so the number that changes most lands last.
  const stagger = (index: number) => {
    const digits = characters().flatMap((character, position) => (isDigit(character) ? [position] : []));
    if (index === digits.at(-1)) return "2";
    if (index === digits.at(-2)) return "1";
    return undefined;
  };
  return (
    <span class={props.class ?? "hosted-plan-amount"}>
      <span class="sr-only">{props.format(props.value)}</span>
      <span ref={roll.ref} class="t-digit-group" style={{ "--digit-dir-y": direction() }} aria-hidden="true">
        {/* Only the digits roll. The currency sign stays still. */}
        <For each={characters()} keyed={false}>
          {(character, index) => (
            <span
              class={isDigit(character()) ? "t-digit" : undefined}
              data-stagger={isDigit(character()) ? stagger(index) : undefined}
            >
              {character()}
            </span>
          )}
        </For>
      </span>
    </span>
  );
}

function isDigit(character: string) {
  return /\d/u.test(character);
}
