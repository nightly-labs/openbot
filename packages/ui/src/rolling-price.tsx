import { createMemo, untrack } from "solid-js";
import { createDigitRoll } from "./digit-roll";
import { DigitRuns } from "./digit-runs";
import { prefersReducedMotion } from "./utils";

export function RollingPrice(props: { value: number; format: (value: number) => string; class?: string }) {
  const roll = createDigitRoll(() => props.value, { settleMs: 0, animate: () => !prefersReducedMotion() });
  let previous = untrack(roll.displayed);
  const direction = createMemo(() => {
    const next = roll.displayed();
    const result = next < previous ? -1 : 1;
    previous = next;
    return result;
  });
  const characters = () => props.format(roll.displayed()).split("");
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
        <DigitRuns
          text={characters().join("")}
          digit={(character, index) => (
            <span
              class={isDigit(character()) ? "t-digit" : undefined}
              data-stagger={isDigit(character()) ? stagger(index()) : undefined}
            >
              {character()}
            </span>
          )}
        />
      </span>
    </span>
  );
}

function isDigit(character: string) {
  return /\d/u.test(character);
}
