/**
 * The right-click menu on an agent, in the pinned group and in a section alike. Filing the agent
 * away is `SidebarMoveToSubmenu`, which the channel menu shows too; everything here is agent-only.
 */

import { AppWindow, ContextMenu, Copy, MessageCirclePlus, Moon, Pin, PinOff, RotateCcw } from "@openbot/ui";
import { Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { DeleteIcon, EditIcon } from "./SidebarIcons";
import { SidebarMoveToSubmenu } from "./SidebarMoveToSubmenu";
import type { SidebarPinnedItem } from "./sidebar-pins";
import { useSidebarScope } from "./sidebar-scope";

/** `userHidden` swaps the hide item for a restore item that names the section the agent goes back to. */
export function SidebarAgentContextMenu(menuProps: { agent: AgentProfile; pinned: boolean; userHidden?: boolean }) {
  const { customSectionById, openDelete, props } = useSidebarScope();
  const { t } = useText();
  const ref = (): SidebarPinnedItem => ({ kind: "agent", id: menuProps.agent.id });
  const restoreLabel = () => {
    const assigned = props.layout.agentAssignments[menuProps.agent.id];
    const section = assigned ? customSectionById().get(assigned) : undefined;
    return section ? t("sidebar.agentMenu.restoreTo", { section: section.name }) : t("sidebar.agentMenu.restore");
  };
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content class="agent-context-menu" aria-label={t("sidebar.agentMenu.label")}>
        <ContextMenu.Item
          data-cuelume-tap="toggle"
          onSelect={() => (menuProps.pinned ? props.onUnpin(ref()) : props.onPin(ref()))}
        >
          <Show when={menuProps.pinned} fallback={<Pin class="agent-context-icon size-4" aria-hidden="true" />}>
            <PinOff class="agent-context-icon size-4" aria-hidden="true" />
          </Show>
          <span>{menuProps.pinned ? t("sidebar.unpin") : t("sidebar.pin")}</span>
        </ContextMenu.Item>
        <Show when={!menuProps.userHidden && props.onNewAgentThread}>
          {(start) => (
            <ContextMenu.Item onSelectAfterClose={() => start()(menuProps.agent.id)}>
              <MessageCirclePlus class="agent-context-icon size-4" aria-hidden="true" />
              <span>{t("sidebar.agentMenu.newThread")}</span>
            </ContextMenu.Item>
          )}
        </Show>
        <Show when={!menuProps.userHidden && props.onOpenAgentWindow}>
          {(open) => (
            <ContextMenu.Item onSelect={() => open()(menuProps.agent.id)}>
              <AppWindow class="agent-context-icon size-4" aria-hidden="true" />
              <span>{t("sidebar.agentMenu.openWindow")}</span>
            </ContextMenu.Item>
          )}
        </Show>
        <SidebarMoveToSubmenu chatId={menuProps.agent.id} />
        <ContextMenu.Item onSelect={() => props.onEditAgent(menuProps.agent.id)}>
          <EditIcon />
          <span>{t("sidebar.agentMenu.edit")}</span>
        </ContextMenu.Item>
        <Show when={props.duplicateSupported !== false && props.onDuplicateAgent}>
          <ContextMenu.Item
            disabled={props.duplicatingAgentIds?.has(menuProps.agent.id) ?? false}
            onSelect={() => void props.onDuplicateAgent?.(menuProps.agent.id).catch(() => undefined)}
          >
            <Copy class="agent-context-icon size-4" aria-hidden="true" />
            <span>
              {props.duplicatingAgentIds?.has(menuProps.agent.id)
                ? t("sidebar.agentMenu.duplicating")
                : t("sidebar.agentMenu.duplicate")}
            </span>
          </ContextMenu.Item>
        </Show>
        <Show when={!menuProps.userHidden && props.onHideAgent}>
          <ContextMenu.Item onSelectAfterClose={() => props.onHideAgent?.(menuProps.agent.id)}>
            <Moon class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("sidebar.agentMenu.hide")}</span>
          </ContextMenu.Item>
        </Show>
        <Show when={menuProps.userHidden && props.onRestoreAgent}>
          <ContextMenu.Item onSelectAfterClose={() => props.onRestoreAgent?.(menuProps.agent.id)}>
            <RotateCcw class="agent-context-icon size-4" aria-hidden="true" />
            <span>{restoreLabel()}</span>
          </ContextMenu.Item>
        </Show>
        <Show when={props.deleteSupported !== false}>
          <ContextMenu.Separator />
          <ContextMenu.Item
            class="ui-action-menu-danger agent-context-danger"
            onSelect={() => openDelete("agent", menuProps.agent.id)}
          >
            <DeleteIcon />
            <span>{t("sidebar.agentMenu.delete")}</span>
          </ContextMenu.Item>
        </Show>
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}
