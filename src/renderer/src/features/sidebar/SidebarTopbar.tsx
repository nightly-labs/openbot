/** The server name, the marketplace or expand toggle, and new agent - plus the window drag region. */

import { Show } from "solid-js";
import { Bot, Button, DropdownMenu, Hash, Puzzle } from "../../components/ui";
import { useI18n } from "../i18n/i18n-context";
import { PlusIcon, SidebarToggleIcon } from "./SidebarIcons";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarTopbar() {
  const { props } = useSidebarScope();
  const i18n = useI18n();
  return (
    <div class="window-drag sidebar-topbar">
      <Button
        variant="ghost"
        size="sm"
        type="button"
        class="sidebar-server-name no-drag"
        aria-label={i18n.t("sidebar.openSettingsFor", { server: props.serverName })}
        aria-hidden={props.compact ? "true" : undefined}
        tabindex={props.compact ? -1 : 0}
        title={props.serverName}
        onClick={(event) => props.onOpenServerSettings(event.currentTarget)}
      >
        <span class="sidebar-server-name-label">{props.serverName}</span>
      </Button>
      <div class="sidebar-topbar-actions">
        <Button
          variant="ghost"
          type="button"
          class={[
            "sidebar-icon-button no-drag",
            props.compact ? "sidebar-toggle-button" : "sidebar-marketplace-button",
          ]}
          onClick={() => (props.compact ? props.onExpand() : props.onOpenMarketplace())}
          aria-label={props.compact ? i18n.t("sidebar.expand") : i18n.t("sidebar.openMarketplace")}
          aria-controls={props.compact ? "agent-sidebar" : undefined}
          aria-expanded={props.compact ? "false" : undefined}
          title={props.compact ? i18n.t("sidebar.expand") : i18n.t("sidebar.marketplace")}
        >
          <Show when={props.compact} fallback={<Puzzle aria-hidden="true" />}>
            <SidebarToggleIcon />
          </Show>
        </Button>
        <DropdownMenu.Root placement="bottom-end" gutter={4}>
          <DropdownMenu.Trigger
            class="sidebar-icon-button sidebar-new-button no-drag"
            aria-label={i18n.t("sidebar.newAgentOrChannel")}
            aria-hidden={props.compact ? "true" : undefined}
            tabindex={props.compact ? -1 : 0}
          >
            <PlusIcon />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <DropdownMenu.Item onSelect={props.onCreateAgent}>
                <Bot aria-hidden="true" />
                {i18n.t("sidebar.newAgent")}
              </DropdownMenu.Item>
              <Show when={props.onCreateChannel}>
                <DropdownMenu.Item onSelect={() => props.onCreateChannel?.()}>
                  <Hash aria-hidden="true" />
                  {i18n.t("sidebar.newChannel")}
                </DropdownMenu.Item>
              </Show>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}
