import { Show } from "solid-js";
import { SidebarDiagramList } from "./SidebarDiagramList";
import { SidebarDialogs } from "./SidebarDialogs";
import { SidebarFrame } from "./SidebarFrame";
import { SidebarNav } from "./SidebarNav";
import { SidebarSearch } from "./SidebarSearch";
import { SidebarTopbar } from "./SidebarTopbar";
import { SidebarViewSwitch } from "./SidebarViewSwitch";
import { createSidebarScope, SidebarScopeContext } from "./sidebar-scope";
import type { SidebarProps } from "./sidebar-types";

export function Sidebar(props: SidebarProps) {
  const scope = createSidebarScope(props);
  return (
    <SidebarScopeContext value={scope}>
      <SidebarFrame compact={props.compact}>
        <SidebarTopbar />

        <SidebarSearch />

        <Show when={props.onViewChange && !props.compact}>
          <SidebarViewSwitch />
        </Show>

        <Show when={props.view === "diagrams"} fallback={<SidebarNav />}>
          <SidebarDiagramList />
        </Show>

        <Show when={!props.compact}>{props.footer}</Show>

        <SidebarDialogs />
      </SidebarFrame>
    </SidebarScopeContext>
  );
}
