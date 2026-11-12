import { For } from "solid-js";
import ballLilac from "./assets/plush/ball-lilac.webp";
import ballMint from "./assets/plush/ball-mint.webp";
import ballPink from "./assets/plush/ball-pink.webp";
import bodyLilac from "./assets/plush/body-lilac.webp";
import eyeLeft from "./assets/plush/eye-left.webp";
import eyeRight from "./assets/plush/eye-right.webp";
import { cx } from "./utils";

/** A face that the lilac plush can make. `idle` breathes, blinks and looks around. */
export type PlushMascotFace = "idle" | "wide" | "wink" | "happy";

const BALLS = [ballLilac, ballMint, ballPink];

/**
 * The lilac OpenBot plush. Each layer moves on its own: the body breathes, the eye pair looks
 * around, and each eye blinks. The eye layers cover the whole body, so they line up without offsets.
 * The parent sets the width with `--ui-plush-size`.
 */
export function PlushMascot(props: { face?: PlushMascotFace; class?: string }) {
  return (
    <span class={cx("ui-plush-mascot", props.class)} data-face={props.face ?? "idle"} aria-hidden="true">
      <span class="ui-plush-body">
        <img class="ui-plush-body-image" src={bodyLilac} alt="" draggable={false} />
        <span class="ui-plush-eyes">
          <img class="ui-plush-eye" data-side="left" src={eyeLeft} alt="" draggable={false} />
          <img class="ui-plush-eye" data-side="right" src={eyeRight} alt="" draggable={false} />
        </span>
      </span>
    </span>
  );
}

export interface PlushLoaderProps {
  /** The width of the plush in pixels. The balls scale with it. The default is 32. */
  size?: number;
  /** `row` puts the balls beside the plush, in a line of text. `stack` puts them under it. */
  layout?: "row" | "stack";
  /** What the loader waits for, for a screen reader. Without it, the loader is decoration. */
  label?: string;
  class?: string;
}

/**
 * The lilac plush watches three felt balls bounce in a wave, and its eyes follow the ball in the
 * air. Use it for a wait that a user sees for more than a moment: a panel that loads, or a step in
 * another app. Buttons and small inline waits keep `Spinner`.
 */
export function PlushLoader(props: PlushLoaderProps) {
  return (
    <span
      class={cx("ui-plush-loader", props.class)}
      data-layout={props.layout ?? "row"}
      style={{ "--ui-plush-size": `${props.size ?? 32}px` }}
      role="status"
      aria-label={props.label}
      aria-hidden={props.label ? undefined : "true"}
    >
      <PlushMascot />
      <span class="ui-plush-balls" aria-hidden="true">
        <For each={BALLS}>{(src) => <img class="ui-plush-ball" src={src} alt="" draggable={false} />}</For>
      </span>
    </span>
  );
}
