import { Skeleton, Spinner } from "@openbot/ui";
import { createSignal, Show } from "solid-js";
import { useText } from "../../text";

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
        <CardPictureLoading />
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

export function CardPictureLoading() {
  const { t } = useText();
  return (
    <>
      <Skeleton class="wfn-media-loading" />
      <span class="wfn-media-spinner">
        <Spinner label={t("common.loading")} />
      </span>
    </>
  );
}
