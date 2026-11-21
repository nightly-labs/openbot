import type { JSX } from "@solidjs/web";
import { createUniqueId } from "solid-js";
import { cx } from "../../utils";
import "./credits.css";

const SPARK =
  "M12 5.6c.55 3.75 2.65 5.85 6.4 6.4-3.75.55-5.85 2.65-6.4 6.4-.55-3.75-2.65-5.85-6.4-6.4 3.75-.55 5.85-2.65 6.4-6.4Z";

export function CreditIcon(props: { class?: string | undefined }): JSX.Element {
  const id = `credit-coin-${createUniqueId()}`;
  return (
    <span class={cx("credit-icon", props.class)}>
      <svg class="credit-coin" viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" class="credit-coin-basic" />
            <stop offset="0.55" class="credit-coin-plus" />
            <stop offset="1" class="credit-coin-max" />
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="11" fill={`url(#${id})`} />
        <circle class="credit-coin-ring" cx="12" cy="12" r="8.6" fill="none" stroke-width="1" />
        <path class="credit-coin-spark" d={SPARK} />
      </svg>
    </span>
  );
}

export function CreditAmount(props: { value: string; class?: string | undefined }): JSX.Element {
  return (
    <span class={cx("credit-amount", props.class)}>
      <CreditIcon />
      {props.value}
    </span>
  );
}
