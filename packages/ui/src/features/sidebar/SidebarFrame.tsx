import { For, type ParentProps } from "solid-js";
import { useText } from "../../text";

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

const SIDEBAR_PLUSH_RINGS = [
  { id: "sidebar-plush-ring", color: "var(--openbot-bg-sidebar)" },
  { id: "sidebar-plush-ring-raised", color: "var(--openbot-bg-control)" },
  { id: "sidebar-plush-ring-hover", color: "var(--openbot-bg-control-hover)" },
  { id: "sidebar-plush-ring-selected", color: "var(--sidebar-row-selected)" },
] as const;

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
