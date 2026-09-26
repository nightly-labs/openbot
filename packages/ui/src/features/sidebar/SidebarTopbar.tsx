/** The server name, the marketplace or expand toggle, and new agent - plus the window drag region. */

import { Bot, Button, DropdownMenu, FolderPlus, Hash, Puzzle } from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";
import { ServerMenu } from "../servers/ServerMenu";
import { PlusIcon, SidebarToggleIcon } from "./SidebarIcons";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarTopbar() {
  const { layoutMutable, props, startCreateSection } = useSidebarScope();
  const { t } = useText();
  return (
    <div class="window-drag sidebar-topbar">
      <Show
        when={props.serverMenu}
        fallback={
          <Button
            variant="ghost"
            size="sm"
            type="button"
            class="sidebar-server-name no-drag"
            aria-label={t("sidebar.topbar.openSettings", { name: props.serverName })}
            aria-hidden={props.compact ? "true" : undefined}
            tabindex={props.compact ? -1 : 0}
            disabled={!props.onOpenServerSettings}
            title={props.serverName}
            onClick={(event) => props.onOpenServerSettings?.(event.currentTarget)}
          >
            <span class="sidebar-server-name-label">{props.serverName}</span>
          </Button>
        }
      >
        {(serverMenu) => (
          <ServerMenu
            {...serverMenu()}
            serverName={props.serverName}
            compact={props.compact}
            onOpenMarketplace={props.marketplaceSupported !== false ? props.onOpenMarketplace : undefined}
          />
        )}
      </Show>
      <div class="sidebar-topbar-actions">
        {/* The menu view needs the room for the server name, so its menu holds the marketplace. */}
        <Show when={props.compact || (props.marketplaceSupported !== false && props.serverMenu?.view !== "menu")}>
          <Button
            variant="ghost"
            type="button"
            class={[
              "sidebar-icon-button no-drag",
              props.compact ? "sidebar-toggle-button" : "sidebar-marketplace-button",
            ]}
            onClick={() => (props.compact ? props.onExpand() : props.onOpenMarketplace())}
            aria-label={props.compact ? t("sidebar.topbar.expand") : t("sidebar.topbar.openMarketplace")}
            aria-controls={props.compact ? "agent-sidebar" : undefined}
            aria-expanded={props.compact ? "false" : undefined}
            title={props.compact ? t("sidebar.topbar.expand") : t("sidebar.topbar.marketplace")}
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
              aria-label={t("sidebar.new.menu")}
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
                    {t("sidebar.new.agent")}
                  </DropdownMenu.Item>
                </Show>
                <Show when={props.onCreateChannel}>
                  <DropdownMenu.Item onSelect={() => props.onCreateChannel?.()}>
                    <Hash aria-hidden="true" />
                    {t("sidebar.new.channel")}
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
                    {t("sidebar.new.section")}
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
