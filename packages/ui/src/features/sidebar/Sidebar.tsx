import { Show } from "solid-js";
import { SidebarDialogs } from "./SidebarDialogs";
import { SidebarFrame } from "./SidebarFrame";
import { SidebarNav } from "./SidebarNav";
import { SidebarSearch } from "./SidebarSearch";
import { SidebarTabs } from "./SidebarTabs";
import { SidebarTopbar } from "./SidebarTopbar";
import { createSidebarScope, SidebarScopeContext } from "./sidebar-scope";
import type { SidebarProps } from "./sidebar-types";

export function Sidebar(props: SidebarProps) {
  const scope = createSidebarScope(props);
  return (
    <SidebarScopeContext value={scope}>
      <SidebarFrame compact={props.compact}>
        <SidebarTopbar />

        <SidebarSearch />

        <SidebarTabs>
          <SidebarNav />
        </SidebarTabs>

        <Show when={!props.compact}>{props.footer}</Show>

        <SidebarDialogs />
      </SidebarFrame>
    </SidebarScopeContext>
  );
}
