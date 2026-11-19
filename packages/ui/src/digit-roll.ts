import { createEffect, createSignal, onCleanup, untrack } from "solid-js";

const SETTLE_MS = 400;

export interface DigitRollOptions {
  settleMs?: number;
  animate?: () => boolean;
}

export function createDigitRoll(value: () => number, options: DigitRollOptions = {}) {
  const [displayed, setDisplayed] = createSignal(untrack(value));
  let latest = untrack(value);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let group: HTMLElement | undefined;

  createEffect(value, (next) => {
    latest = next;
    if (timer !== undefined || next === untrack(displayed)) return;
    timer = setTimeout(() => {
      timer = undefined;
      setDisplayed(latest);
    }, options.settleMs ?? SETTLE_MS);
  });
  onCleanup(() => clearTimeout(timer));

  createEffect(displayed, () => {
    if (!group || options.animate?.() === false) return;
    group.classList.remove("is-animating");
    void group.offsetHeight;
    group.classList.add("is-animating");
  });

  return {
    displayed,
    ref: (element: HTMLElement) => {
      group = element;
    },
  };
}
