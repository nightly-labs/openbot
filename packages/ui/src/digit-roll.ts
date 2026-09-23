import { createEffect, createSignal, onCleanup, untrack } from "solid-js";

/** How long a value has to hold still before the digits roll to it. */
const SETTLE_MS = 400;

export interface DigitRollOptions {
  /** Overrides the settle window. Milliseconds. */
  settleMs?: number;
  /** Whether the group is on screen. A hidden group updates its digits without rolling them. */
  animate?: () => boolean;
}

/**
 * A `t-digit-group` that rolls once per settled value.
 *
 * The roll is a CSS animation restarted by re-applying `is-animating`, so a value that changes
 * faster than the animation lasts restarts it before it ends, and every restart puts the digits
 * back to the blurred, half-transparent first frame. A download reports every whole percent, which
 * is exactly that case: the number a user watched never reached full opacity. Holding the newest
 * value for one settle window gives each roll time to finish, and the caller keeps reporting the
 * live value to assistive technology, which never sees the delay.
 */
export function createDigitRoll(value: () => number, options: DigitRollOptions = {}) {
  const [displayed, setDisplayed] = createSignal(untrack(value));
  let latest = untrack(value);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let group: HTMLElement | undefined;

  createEffect(value, (next) => {
    latest = next;
    if (timer !== undefined || next === untrack(displayed)) return;
    // The newest value when the window ends, not a queue of the ones it replaced.
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
