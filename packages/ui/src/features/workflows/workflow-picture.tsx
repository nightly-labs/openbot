import { Skeleton } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";

const VIDEO_FRAME_SECONDS = 0.1;

export function CardPicture(props: {
  src: string;
  alt: string;
  class?: string | undefined;
  ref?: ((element: HTMLImageElement) => void) | undefined;
}) {
  const [ready, setReady] = createSignal<string>();
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

export function VideoFrame(props: { src: string; card?: boolean | undefined; fallback: JSX.Element }) {
  const [state, setState] = createSignal<"loading" | "ready" | "failed">("loading");
  const showFrame = (video: HTMLVideoElement) => {
    const middle = video.duration / 2;
    video.currentTime = Number.isFinite(middle) ? Math.min(VIDEO_FRAME_SECONDS, middle) : VIDEO_FRAME_SECONDS;
  };
  return (
    <Show when={state() !== "failed"} fallback={props.fallback}>
      <Show when={props.card && state() === "loading"}>
        <Skeleton class="wfn-media-loading" />
      </Show>
      <video
        class="wfn-media"
        src={props.src}
        muted
        playsinline
        preload="metadata"
        onLoadedMetadata={(event) => showFrame(event.currentTarget)}
        onSeeked={() => setState("ready")}
        onError={() => setState("failed")}
      />
    </Show>
  );
}

export function CardPictureLoading() {
  return <Skeleton class="wfn-media-loading" />;
}
