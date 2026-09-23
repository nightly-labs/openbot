import type { ParentProps } from "solid-js";

/** The navigation surface shared by the desktop and browser composition roots. */
export function SidebarFrame(props: ParentProps<{ compact?: boolean }>) {
  return (
    <aside
      id="agent-sidebar"
      aria-label="Agent navigation"
      class={["sidebar panel-edge", { "sidebar-compact": props.compact === true }]}
    >
      {props.children}
    </aside>
  );
}
