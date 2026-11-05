import { For, type ParentProps } from "solid-js";
import { useText } from "../../text";

/** The navigation surface shared by the desktop and browser composition roots. */
export function SidebarFrame(props: ParentProps<{ compact?: boolean }>) {
  const { t } = useText();
  return (
    <aside
      id="agent-sidebar"
      aria-label={t("sidebar.frame.label")}
      class={["sidebar panel-edge", { "sidebar-compact": props.compact === true }]}
    >
      <SidebarPlushRingFilters />
      {props.children}
    </aside>
  );
}

/**
 * One filter for each row colour under the faces: the sidebar, and the hover and selected rows.
 * A filter reads its flood colour where it is in the page, not where it is used, so each colour
 * needs its own filter. `channel-avatar.css` selects them.
 */
const SIDEBAR_PLUSH_RINGS = [
  { id: "sidebar-plush-ring", color: "var(--openbot-bg-sidebar)" },
  { id: "sidebar-plush-ring-raised", color: "var(--openbot-bg-control)" },
  { id: "sidebar-plush-ring-hover", color: "var(--openbot-bg-control-hover)" },
] as const;

/**
 * The ring of the plush faces in a channel cluster. Single hairs make the fur edge noisy, so the
 * filter blurs the edge first and cuts it at 30%: a smooth outline of the face with an anti-aliased
 * edge. That outline, grown by the ring width and filled with the row colour, is the ring under the
 * face. The face is cut to the outline, so it has the smooth, crisp edge of the "+N" count. A dilate
 * radius of 3 draws the same gap between faces as the 3.5px ring of the count, in device pixels.
 * The filter is on the avatar box, so its units are CSS pixels at every avatar size.
 */
function SidebarPlushRingFilters() {
  return (
    <svg class="sidebar-plush-ring-defs" width="0" height="0" aria-hidden="true">
      <For each={SIDEBAR_PLUSH_RINGS}>
        {(ring) => (
          <filter id={ring.id} x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" result="soft" />
            <feComponentTransfer in="soft" result="hard">
              <feFuncA type="linear" slope="8" intercept="-2.4" />
            </feComponentTransfer>
            <feMorphology in="hard" operator="dilate" radius="3" result="grown" />
            <feFlood style={{ "flood-color": ring.color }} />
            <feComposite in2="grown" operator="in" result="ring" />
            <feComposite in="SourceGraphic" in2="hard" operator="in" result="face" />
            <feMerge>
              <feMergeNode in="ring" />
              <feMergeNode in="face" />
            </feMerge>
          </filter>
        )}
      </For>
    </svg>
  );
}
