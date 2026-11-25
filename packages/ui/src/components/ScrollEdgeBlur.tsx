import { For } from "solid-js";

const BLUR_LAYERS = [1, 2, 3, 4, 5] as const;

export interface ScrollEdgeBlurState {
  top: () => boolean;
  bottom: () => boolean;
  stuckHeight: () => number;
}

function ScrollEdgeBlurBand(props: { edge: "top" | "bottom"; visible: boolean }) {
  return (
    <div class={["scroll-edge-blur-band", { "scroll-edge-blur-visible": props.visible }]} data-edge={props.edge}>
      <For each={BLUR_LAYERS}>{() => <span class="scroll-edge-blur-layer" />}</For>
    </div>
  );
}

export function ScrollEdgeBlur(props: { fades: ScrollEdgeBlurState }) {
  return (
    <div
      class="scroll-edge-blur"
      aria-hidden="true"
      style={{ "--scroll-edge-blur-offset": `${props.fades.stuckHeight()}px` }}
    >
      <ScrollEdgeBlurBand edge="top" visible={props.fades.top()} />
      <ScrollEdgeBlurBand edge="bottom" visible={props.fades.bottom()} />
    </div>
  );
}
