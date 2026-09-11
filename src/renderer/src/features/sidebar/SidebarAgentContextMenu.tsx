/**
 * The right-click menu on an agent, in the pinned group and in a section alike. Filing the agent
 * away is `SidebarMoveToSubmenu`, which the channel menu shows too; everything here is agent-only.
 */

import { Show } from "solid-js";
import { ContextMenu, Copy, Pin, PinOff } from "../../components/ui";
import type { AgentProfile } from "../../data";
import { DeleteIcon, EditIcon } from "./SidebarIcons";
import { SidebarMoveToSubmenu } from "./SidebarMoveToSubmenu";
import type { SidebarPinnedItem } from "./sidebar-pins";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarAgentContextMenu(menuProps: { agent: AgentProfile; pinned: boolean }) {
  const { openDelete, props } = useSidebarScope();
  const ref = (): SidebarPinnedItem => ({ kind: "agent", id: menuProps.agent.id });
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content class="agent-context-menu" aria-label="Agent actions">
        <ContextMenu.Item onSelect={() => (menuProps.pinned ? props.onUnpin(ref()) : props.onPin(ref()))}>
          <Show when={menuProps.pinned} fallback={<Pin class="agent-context-icon size-4" aria-hidden="true" />}>
            <PinOff class="agent-context-icon size-4" aria-hidden="true" />
          </Show>
          <span>{menuProps.pinned ? "Unpin" : "Pin"}</span>
        </ContextMenu.Item>
        <SidebarMoveToSubmenu chatId={menuProps.agent.id} />
        <ContextMenu.Item onSelect={() => props.onEditAgent(menuProps.agent.id)}>
          <EditIcon />
          <span>Edit agent</span>
        </ContextMenu.Item>
        <Show when={props.duplicateSupported !== false && props.onDuplicateAgent}>
          <ContextMenu.Item
            disabled={props.duplicatingAgentIds?.has(menuProps.agent.id)}
            onSelect={() => void props.onDuplicateAgent?.(menuProps.agent.id).catch(() => undefined)}
          >
            <Copy class="agent-context-icon size-4" aria-hidden="true" />
            <span>{props.duplicatingAgentIds?.has(menuProps.agent.id) ? "Duplicating…" : "Duplicate agent"}</span>
          </ContextMenu.Item>
        </Show>
        <ContextMenu.Separator />
        <ContextMenu.Item
          class="ui-action-menu-danger agent-context-danger"
          onSelect={() => openDelete("agent", menuProps.agent.id)}
        >
          <DeleteIcon />
          <span>Delete agent</span>
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}
