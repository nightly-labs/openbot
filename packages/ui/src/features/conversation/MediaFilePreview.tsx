import { Show } from "solid-js";

export function MediaFilePreview(props: {
  kind: "audio" | "video" | null;
  src: string;
  name: string;
  class?: string;
  preload?: "none" | "metadata";
  /** Plays at once: the user asked for it with the click that loaded the file. */
  autoplay?: boolean;
}) {
  return (
    <>
      <Show when={props.kind === "audio"}>
        <audio
          class={props.class}
          controls
          autoplay={props.autoplay}
          preload={props.preload}
          src={props.src}
          aria-label={props.name}
        >
          {/* Local files do not provide caption tracks. */}
          <track kind="captions" />
        </audio>
      </Show>
      <Show when={props.kind === "video"}>
        <video
          class={props.class}
          controls
          playsinline
          autoplay={props.autoplay}
          preload={props.preload}
          src={props.src}
          aria-label={props.name}
        >
          <track kind="captions" />
        </video>
      </Show>
    </>
  );
}
