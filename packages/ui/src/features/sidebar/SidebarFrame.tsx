import type { ParentProps } from "solid-js";
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
      {props.children}
    </aside>
  );
}
