import type { JSX } from "@solidjs/web";
import { cx } from "../../utils";
import "./credits.css";

const STAR =
  "M12 2.5c.9 0 1.3.8 1.6 1.9.8 3.1 2.9 5.2 6 6 1.1.3 1.9.7 1.9 1.6s-.8 1.3-1.9 1.6c-3.1.8-5.2 2.9-6 6-.3 1.1-.7 1.9-1.6 1.9s-1.3-.8-1.6-1.9c-.8-3.1-2.9-5.2-6-6C3.3 13.3 2.5 12.9 2.5 12s.8-1.3 1.9-1.6c3.1-.8 5.2-2.9 6-6 .3-1.1.7-1.9 1.6-1.9Z";

export function CreditIcon(props: { class?: string | undefined }): JSX.Element {
  return (
    <span class={cx("credit-icon", props.class)}>
      <svg class="credit-star" viewBox="0 0 24 24" aria-hidden="true">
        <path d={STAR} />
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
