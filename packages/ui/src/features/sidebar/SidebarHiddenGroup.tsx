import { Button, ChevronDown } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { SidebarAgentRow } from "./SidebarAgentRow";
import { useSidebarScope } from "./sidebar-scope";
import { SIDEBAR_HIDDEN_GROUP_OPEN_ID } from "./sidebar-types";

const BODY_ID = "sidebar-hidden-agents-body";

export function SidebarHiddenGroup() {
  const { props, sectionIsCollapsed, userHiddenAgentList } = useSidebarScope();
  const { t } = useText();
  const count = () => userHiddenAgentList().length;
  const open = () => sectionIsCollapsed(SIDEBAR_HIDDEN_GROUP_OPEN_ID);
  return (
    <Show when={count() > 0}>
      <section
        class="sidebar-chat-group sidebar-section sidebar-hidden-group"
        aria-label={t("sidebar.hidden.label", { count: count() })}
      >
        <header>
          <Button
            variant="ghost"
            type="button"
            class="sidebar-section-toggle"
            aria-label={t("sidebar.hidden.label", { count: count() })}
            aria-expanded={open() ? "true" : "false"}
            aria-controls={BODY_ID}
            data-cuelume-open={open() ? undefined : ""}
            data-cuelume-close={open() ? "" : undefined}
            data-cuelume-emphasis="subtle"
            onClick={() => props.onToggleSection(SIDEBAR_HIDDEN_GROUP_OPEN_ID)}
          >
            <span class="sidebar-section-name">
              {t("sidebar.hidden.title")}
              <span class="sidebar-hidden-group-count">{t("sidebar.hidden.count", { count: count() })}</span>
            </span>
            <ChevronDown
              class={`sidebar-section-chevron size-4${open() ? "" : " sidebar-section-chevron-collapsed"}`}
              aria-hidden="true"
            />
          </Button>
        </header>
        <div
          class="sidebar-section-collapse"
          data-collapsed={open() ? undefined : ""}
          aria-hidden={open() ? undefined : "true"}
          inert={open() ? undefined : true}
        >
          <div id={BODY_ID} class="sidebar-section-body">
            <For each={userHiddenAgentList()}>{(agent) => <SidebarAgentRow agent={agent} userHidden />}</For>
          </div>
        </div>
      </section>
    </Show>
  );
}
