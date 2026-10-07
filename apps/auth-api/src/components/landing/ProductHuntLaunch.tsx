import { Show } from "solid-js";
import { EXTERNAL_LINK_REL, OPENBOT_LINKS, PRODUCT_HUNT_LAUNCH_LIVE } from "../../lib/landing-links";

function UpvoteArrow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4 21 18H3Z" />
    </svg>
  );
}

/** The hero line that points at the launch page. Only the landing page shows it. */
export function ProductHuntPill() {
  return (
    <Show when={PRODUCT_HUNT_LAUNCH_LIVE}>
      <a class="ph-pill" href={OPENBOT_LINKS.productHunt} target="_blank" rel={EXTERNAL_LINK_REL}>
        <span class="ph-pill-mark">
          <UpvoteArrow />
        </span>
        <span class="ph-pill-copy">
          We're live on <strong>Product Hunt</strong>
        </span>
        <span class="ph-pill-cta">Upvote</span>
      </a>
    </Show>
  );
}
