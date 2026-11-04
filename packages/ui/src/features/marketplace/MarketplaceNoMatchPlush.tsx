import { createSignal, onSettled, Show } from "solid-js";
import fishingLoop from "../../assets/plush/fishing.webm";
import fishingStill from "../../assets/plush/fishing-still.webp";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * The plush of the Marketplace "no match" state: it sits and fishes in an 8-second loop. It is
 * decoration: the text below it is the accessible content. With reduced motion it is a still image.
 */
export function MarketplaceNoMatchPlush() {
  const query = window.matchMedia?.(REDUCED_MOTION);
  const [still, setStill] = createSignal(query?.matches ?? false);
  let video: HTMLVideoElement | undefined;

  onSettled(() => {
    const update = () => setStill(query?.matches ?? false);
    query?.addEventListener("change", update);
    return () => {
      query?.removeEventListener("change", update);
      video?.pause();
    };
  });

  return (
    <span class="marketplace-empty-plush" aria-hidden="true">
      <Show when={!still()} fallback={<img src={fishingStill} alt="" draggable={false} />}>
        <video
          ref={(element) => {
            video = element;
            // The attribute alone does not mute a cloned element, and autoplay needs a muted video.
            element.muted = true;
          }}
          src={fishingLoop}
          poster={fishingStill}
          muted
          autoplay
          loop
          playsinline
          preload="auto"
        />
      </Show>
    </span>
  );
}
