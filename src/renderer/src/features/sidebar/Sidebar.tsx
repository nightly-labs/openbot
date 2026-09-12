import { useI18n } from "../i18n/i18n-context";
import { SidebarDialogs } from "./SidebarDialogs";
import { SidebarNav } from "./SidebarNav";
import { SidebarSearch } from "./SidebarSearch";
import { SidebarTopbar } from "./SidebarTopbar";
import { createSidebarScope, SidebarScopeContext } from "./sidebar-scope";
import type { SidebarProps } from "./sidebar-types";

export function Sidebar(props: SidebarProps) {
  const i18n = useI18n();
  const scope = createSidebarScope(props);
  return (
    <SidebarScopeContext value={scope}>
      <aside
        id="agent-sidebar"
        aria-label={i18n.t("sidebar.agentNavigation")}
        class={["sidebar panel-edge", { "sidebar-compact": props.compact }]}
      >
        <SidebarTopbar />

        <SidebarSearch />

        <SidebarNav />

        <SidebarDialogs />
      </aside>
    </SidebarScopeContext>
  );
}
