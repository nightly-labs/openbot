/**
 * "Archived": the agents that a user archived for long-term storage. Like "Hidden", it is not a
 * section of the layout: it has no drag target and no section menu, and each agent keeps its own
 * section for an unarchive. It is collapsed until the user opens it.
 * `SIDEBAR_ARCHIVED_GROUP_OPEN_ID` records the open state in the same per-scope storage as the
 * collapsed sections.
 */

import { Button, ChevronDown } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { SidebarAgentRow } from "./SidebarAgentRow";
import { useSidebarScope } from "./sidebar-scope";
import { SIDEBAR_ARCHIVED_GROUP_OPEN_ID } from "./sidebar-types";

const BODY_ID = "sidebar-archived-agents-body";

export function SidebarArchivedGroup() {
  const { props, sectionIsCollapsed, userArchivedAgentList } = useSidebarScope();
  const { t } = useText();
  const count = () => userArchivedAgentList().length;
  const open = () => sectionIsCollapsed(SIDEBAR_ARCHIVED_GROUP_OPEN_ID);
  return (
    <Show when={count() > 0}>
      <section
        class="sidebar-chat-group sidebar-section sidebar-archived-group"
        aria-label={t("sidebar.archived.label", { count: count() })}
      >
        <header>
          <Button
            variant="ghost"
            type="button"
            class="sidebar-section-toggle"
            aria-label={t("sidebar.archived.label", { count: count() })}
            aria-expanded={open() ? "true" : "false"}
            aria-controls={BODY_ID}
            data-cuelume-open={open() ? undefined : ""}
            data-cuelume-close={open() ? "" : undefined}
            data-cuelume-emphasis="subtle"
            onClick={() => props.onToggleSection(SIDEBAR_ARCHIVED_GROUP_OPEN_ID)}
          >
            <span class="sidebar-section-name">
              {t("sidebar.archived.title")}
              <span class="sidebar-archived-group-count">{t("sidebar.archived.count", { count: count() })}</span>
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
            <For each={userArchivedAgentList()}>
              {(agent) => <SidebarAgentRow agent={agent} userArchived />}
            </For>
          </div>
        </div>
      </section>
    </Show>
  );
}
