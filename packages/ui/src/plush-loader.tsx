import { For } from "solid-js";
import ballLilac from "./assets/plush/ball-lilac.webp";
import ballMint from "./assets/plush/ball-mint.webp";
import ballPink from "./assets/plush/ball-pink.webp";
import bodyLilac from "./assets/plush/body-lilac.webp";
import eyeLeft from "./assets/plush/eye-left.webp";
import eyeRight from "./assets/plush/eye-right.webp";
import { cx } from "./utils";

export type PlushMascotFace = "idle" | "wide" | "wink" | "happy";

const BALLS = [ballLilac, ballMint, ballPink];

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
  size?: number;
  layout?: "row" | "stack";
  label?: string;
  class?: string;
}

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
