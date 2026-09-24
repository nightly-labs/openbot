/** The server name, the marketplace or expand toggle, and new agent - plus the window drag region. */

import { Bot, Button, DropdownMenu, FolderPlus, Hash, Puzzle } from "@openbot/ui";
import { Show } from "solid-js";
import { PlusIcon, SidebarToggleIcon } from "./SidebarIcons";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarTopbar() {
  const { layoutMutable, props, startCreateSection } = useSidebarScope();
  return (
    <div class="window-drag sidebar-topbar">
      <Button
        variant="ghost"
        size="sm"
        type="button"
        class="sidebar-server-name no-drag"
        aria-label={`Open settings for ${props.serverName}`}
        aria-hidden={props.compact ? "true" : undefined}
        tabindex={props.compact ? -1 : 0}
        disabled={!props.onOpenServerSettings}
        title={props.serverName}
        onClick={(event) => props.onOpenServerSettings?.(event.currentTarget)}
      >
        <span class="sidebar-server-name-label">{props.serverName}</span>
      </Button>
      <div class="sidebar-topbar-actions">
        <Show when={props.compact || props.marketplaceSupported !== false}>
          <Button
            variant="ghost"
            type="button"
            class={[
              "sidebar-icon-button no-drag",
              props.compact ? "sidebar-toggle-button" : "sidebar-marketplace-button",
            ]}
            onClick={() => (props.compact ? props.onExpand() : props.onOpenMarketplace())}
            aria-label={props.compact ? "Expand sidebar" : "Open Marketplace"}
            aria-controls={props.compact ? "agent-sidebar" : undefined}
            aria-expanded={props.compact ? "false" : undefined}
            title={props.compact ? "Expand sidebar" : "Marketplace"}
          >
            <Show when={props.compact} fallback={<Puzzle aria-hidden="true" />}>
              <SidebarToggleIcon />
            </Show>
          </Button>
        </Show>
        <Show when={props.createSupported !== false || props.onCreateChannel || layoutMutable()}>
          <DropdownMenu.Root placement="bottom-end" gutter={4}>
            <DropdownMenu.Trigger
              class="sidebar-icon-button sidebar-new-button no-drag"
              aria-label="New agent or channel"
              aria-hidden={props.compact ? "true" : undefined}
              tabindex={props.compact ? -1 : 0}
            >
              <PlusIcon />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content>
                <Show when={props.createSupported !== false}>
                  <DropdownMenu.Item onSelect={props.onCreateAgent}>
                    <Bot aria-hidden="true" />
                    New agent
                  </DropdownMenu.Item>
                </Show>
                <Show when={props.onCreateChannel}>
                  <DropdownMenu.Item onSelect={() => props.onCreateChannel?.()}>
                    <Hash aria-hidden="true" />
                    New channel
                  </DropdownMenu.Item>
                </Show>
                <Show when={layoutMutable()}>
                  <DropdownMenu.Item
                    onSelect={() => {
                      // Kobalte selects before it closes the menu, so a callback deferred by the
                      // same two frames as the restore would still run first: the editor would open,
                      // take focus in a microtask, then lose it to the trigger and cancel on blur.
                      // Three frames land strictly after the two-frame restore in
                      // focusRestoreHandler (components/ui/complex.tsx). Keep the counts in step.
                      window.requestAnimationFrame(() =>
                        window.requestAnimationFrame(() => window.requestAnimationFrame(() => startCreateSection())),
                      );
                    }}
                  >
                    <FolderPlus aria-hidden="true" />
                    New section
                  </DropdownMenu.Item>
                </Show>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </Show>
      </div>
    </div>
  );
}
