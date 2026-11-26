import type { JSX } from "@solidjs/web";
import { createUniqueId } from "solid-js";
import { useText } from "../../text";
import { cx } from "../../utils";
import "./credits.css";

const STAR =
  "M12 2.5c.9 0 1.3.8 1.6 1.9.8 3.1 2.9 5.2 6 6 1.1.3 1.9.7 1.9 1.6s-.8 1.3-1.9 1.6c-3.1.8-5.2 2.9-6 6-.3 1.1-.7 1.9-1.6 1.9s-1.3-.8-1.6-1.9c-.8-3.1-2.9-5.2-6-6C3.3 13.3 2.5 12.9 2.5 12s.8-1.3 1.9-1.6c3.1-.8 5.2-2.9 6-6 .3-1.1.7-1.9 1.6-1.9Z";

export function CreditIcon(props: { class?: string | undefined; tile?: boolean | undefined }): JSX.Element {
  return (
    <span class={cx("credit-icon", props.class)} data-tile={props.tile ? "" : undefined}>
      <svg class="credit-star" viewBox="0 0 24 24" aria-hidden="true">
        <path d={STAR} />
      </svg>
    </span>
  );
}

export function CreditEmblem(props: { class?: string | undefined }): JSX.Element {
  const id = `credit-emblem-${createUniqueId()}`;
  return (
    <svg class={cx("credit-emblem", props.class)} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-face`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" class="credit-emblem-stop-top" />
          <stop offset="0.55" class="credit-emblem-stop-middle" />
          <stop offset="1" class="credit-emblem-stop-bottom" />
        </linearGradient>
        <radialGradient id={`${id}-gloss`} cx="0.38" cy="0.3" r="0.45">
          <stop offset="0" class="credit-emblem-stop-gloss" />
          <stop offset="1" class="credit-emblem-stop-clear" />
        </radialGradient>
      </defs>
      <path class="credit-emblem-halo" d={STAR} />
      <path d={STAR} fill={`url(#${id}-face)`} />
      <path d={STAR} fill={`url(#${id}-gloss)`} />
      <path class="credit-emblem-rim" d={STAR} />
      <g transform="translate(18.6 2.2) scale(0.2)">
        <path class="credit-emblem-spark" d={STAR} />
      </g>
      <g transform="translate(3 17.4) scale(0.13)">
        <path class="credit-emblem-spark" data-small="" d={STAR} />
      </g>
    </svg>
  );
}

export function CreditAmount(props: { credits: number | null; class?: string | undefined }): JSX.Element {
  const { t, format } = useText();
  const shown = () => (props.credits === null ? "" : format.number(props.credits));
  return (
    <span class={cx("credit-amount", props.class)}>
      <CreditIcon />
      <span aria-hidden="true">{shown()}</span>
      <span class="sr-only">
        {props.credits === null ? "" : t("billing.credits.amount", { count: props.credits, amount: shown() })}
      </span>
    </span>
  );
}
