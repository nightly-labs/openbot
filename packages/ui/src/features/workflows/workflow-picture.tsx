/** A picture that fills a card on the canvas, with a loading state. */

import { Skeleton } from "@openbot/ui";
import { createSignal, Show } from "solid-js";

/**
 * The picture at `src`. A pulse shows until the browser has decoded it. When `src` changes, the
 * last picture stays until the next one is ready, so a new result does not flash an empty card.
 */
export function CardPicture(props: {
  src: string;
  alt: string;
  class?: string | undefined;
  ref?: ((element: HTMLImageElement) => void) | undefined;
}) {
  const [ready, setReady] = createSignal<string>();
  // An error also ends the pulse: the browser shows that the picture is broken.
  const settle = () => setReady(props.src);
  return (
    <>
      <Show when={ready() === undefined}>
        <Skeleton class="wfn-media-loading" />
      </Show>
      <img
        ref={(element: HTMLImageElement) => props.ref?.(element)}
        class={props.class ?? "wfn-media"}
        src={props.src}
        alt={props.alt}
        decoding="async"
        draggable="false"
        onLoad={settle}
        onError={settle}
      />
    </>
  );
}

/** The pulse of a card whose picture has no address yet: the host still sends it. */
export function CardPictureLoading() {
  return <Skeleton class="wfn-media-loading" />;
}
