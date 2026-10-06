/** The switch over the list: every chat, only channels, or the diagrams. */

import { Bot, Hash, SlidingTabs, Workflow } from "@openbot/ui";
import { useText } from "../../text";
import { useSidebarScope } from "./sidebar-scope";
import type { SidebarView } from "./sidebar-types";

const VIEWS = ["agents", "channels", "diagrams"] as const satisfies readonly SidebarView[];

function isSidebarView(value: string): value is SidebarView {
  return VIEWS.some((view) => view === value);
}

export function SidebarViewSwitch() {
  const { props } = useSidebarScope();
  const { t } = useText();
  return (
    <div class="sidebar-view-switch">
      <SlidingTabs.Root
        value={props.view ?? "agents"}
        onChange={(value: string) => {
          if (isSidebarView(value)) props.onViewChange?.(value);
        }}
      >
        <SlidingTabs.List class="sidebar-view-tabs" aria-label={t("sidebar.view.label")}>
          <SlidingTabs.Trigger value="agents" class="sidebar-view-tab">
            <Bot aria-hidden="true" />
            {t("sidebar.view.agents")}
          </SlidingTabs.Trigger>
          <SlidingTabs.Trigger value="channels" class="sidebar-view-tab">
            <Hash aria-hidden="true" />
            {t("sidebar.view.channels")}
          </SlidingTabs.Trigger>
          <SlidingTabs.Trigger value="diagrams" class="sidebar-view-tab">
            <Workflow aria-hidden="true" />
            {t("sidebar.view.diagrams")}
          </SlidingTabs.Trigger>
        </SlidingTabs.List>
      </SlidingTabs.Root>
    </div>
  );
}
