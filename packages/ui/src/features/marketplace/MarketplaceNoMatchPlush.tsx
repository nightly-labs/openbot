import { createSignal, onSettled, Show } from "solid-js";
import fishingLoop from "../../assets/plush/fishing.webm";
import fishingStill from "../../assets/plush/fishing-still.webp";
import { REDUCED_MOTION_QUERY } from "../../utils";

/**
 * Whether the browser kept the alpha of the loaded frame. The top-left pixel of the loop is
 * transparent. Safari plays VP9 but drops its alpha, so it draws that pixel opaque.
 */
function keepsAlpha(video: HTMLVideoElement): boolean {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return true;
  try {
    context.drawImage(video, 0, 0, 1, 1, 0, 0, 1, 1);
    return (context.getImageData(0, 0, 1, 1).data[3] ?? 0) < 128;
  } catch {
    return true;
  }
}

/**
 * The plush of the Marketplace "no match" state: it sits and fishes in an 8-second loop. It is
 * decoration: the text below it is the accessible content. With reduced motion, or in a browser
 * that cannot show the transparent loop, it is a still image.
 */
export function MarketplaceNoMatchPlush() {
  const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
  const [reduced, setReduced] = createSignal(query?.matches ?? false);
  const [unplayable, setUnplayable] = createSignal(false);

  onSettled(() => {
    const update = () => setReduced(query?.matches ?? false);
    query?.addEventListener("change", update);
    return () => query?.removeEventListener("change", update);
  });

  return (
    <span class="marketplace-empty-plush" aria-hidden="true">
      <Show when={!reduced() && !unplayable()} fallback={<img src={fishingStill} alt="" draggable={false} />}>
        <video
          ref={(element) => {
            // A cloned element does not take its muted state from the attribute, and autoplay needs it.
            element.muted = true;
          }}
          src={fishingLoop}
          poster={fishingStill}
          muted
          autoplay
          loop
          playsinline
          preload="auto"
          onLoadedData={(event) => {
            if (!keepsAlpha(event.currentTarget)) setUnplayable(true);
          }}
          onError={() => setUnplayable(true)}
        />
      </Show>
    </span>
  );
}
