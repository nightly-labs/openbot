/**
 * "Needs you": every agent that waits for an answer, an approval or a browser takeover, above the
 * sections. It is not a section of the layout. It has no id, no drag target and no collapse, so an
 * agent returns to its own section when the wait ends.
 *
 * The compact sidebar has no room for the heading; the rows keep their order and their badges.
 */

import { For, Show } from "solid-js";
import { useText } from "../../text";
import { SidebarAgentRow } from "./SidebarAgentRow";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarWaitingGroup() {
  const { waitingAgents } = useSidebarScope();
  const { t } = useText();
  return (
    <Show when={waitingAgents().length > 0}>
      <section
        class="sidebar-chat-group sidebar-waiting-group"
        aria-label={t("sidebar.waiting.label", { count: waitingAgents().length })}
      >
        <header>
          <h2 class="sidebar-waiting-group-name">
            {t("sidebar.waiting.title")}
            <span class="sidebar-waiting-group-count" aria-hidden="true">
              {waitingAgents().length}
            </span>
          </h2>
        </header>
        <For each={waitingAgents()}>{(agent) => <SidebarAgentRow agent={agent} waiting />}</For>
      </section>
    </Show>
  );
}
